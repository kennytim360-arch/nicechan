// Nice Chan: reads public forum APIs side by side. Dependency-free Node server.
// Run: npm start   then open http://localhost:3000
const http = require("http");
const fs = require("fs");
const path = require("path");
const config = require("./config.json");
const { createRegistry } = require("./lib/sources");
const { createLatest } = require("./lib/latest");
const { maskItem } = require("./lib/filter");
const { excerpt } = require("./lib/text");
const { createLimiter, visitorHash, adminAllowed } = require("./lib/moderation");
const { startDigest } = require("./lib/digest/service");
const llm = require("./lib/digest/llm");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_STORY_THREADS = 8;
const MAX_STORY_POSTS = 600;

const registry = createRegistry(config);
const digest = startDigest({
  registry,
  file: path.join(__dirname, "data", "nicechan.db"),
  intervalMinutes: Number(process.env.INGEST_MINUTES) || 15,
});
const latest = createLatest(registry, config.latest);

const json = (res, code, obj) => {
  res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
};

// Safe mode is on unless the client explicitly sends safe=0. Masking happens here, before the data leaves the server.
// Every text is also cut to an excerpt, because third-party posts are shown as excerpts with a link to the original.
const shape = it => ({ ...it, text: excerpt(it.text), title: excerpt(it.title, 300) });
const applySafe = (data, safe) => {
  const prep = it => shape(safe ? maskItem(it) : it);
  if (Array.isArray(data)) return data.map(prep);
  return { ...data, items: data.items.map(prep) };
};

const reportLimiter = createLimiter({ max: 10, windowMs: 10 * 60 * 1000 });

async function readBody(req, max = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > max) {
        reject(Object.assign(new Error("Request too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || "{}"));
      } catch {
        reject(Object.assign(new Error("Bad JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function handlePost(req, res, rawParts) {
  const [, a, b] = rawParts;
  const body = await readBody(req);
  const now = Math.floor(Date.now() / 1000);

  if (a === "report") {
    const visitor = visitorHash(req.socket.remoteAddress, new Date());
    if (!reportLimiter.allow(visitor)) return json(res, 429, { error: "Too many reports. Try again later." });
    const source = String(body.source || "");
    const postId = String(body.postId || "");
    if (!registry.ids().includes(source) || !/^[A-Za-z0-9_.-]{1,64}$/.test(postId)) return json(res, 400, { error: "Bad report" });
    digest.store.addReport({ source, postId, reason: String(body.reason || "").slice(0, 200), ipHash: visitor, now });
    return json(res, 202, { ok: true });
  }

  if (a === "admin") {
    if (!adminAllowed(req.headers["x-admin-token"])) return json(res, process.env.ADMIN_TOKEN ? 401 : 503, { error: process.env.ADMIN_TOKEN ? "Not authorised" : "Admin is off. Set ADMIN_TOKEN." });
    if (b === "hide") {
      digest.store.hidePost(String(body.source || ""), String(body.postId || ""), String(body.reason || "").slice(0, 200), now);
      return json(res, 200, { ok: true });
    }
    if (b === "restore") {
      digest.store.unhidePost(String(body.source || ""), String(body.postId || ""));
      return json(res, 200, { ok: true });
    }
    if (b === "resolve") {
      const status = body.status === "actioned" ? "actioned" : "dismissed";
      return json(res, 200, { changed: digest.store.resolveReport(Number(body.id), status) });
    }
  }
  return json(res, 404, { error: "Not found" });
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

// Every cached comment in a story's threads, in time order. Digest text is always masked.
function storyPosts(d) {
  const keys = (d.payload.threads || []).slice(0, MAX_STORY_THREADS);
  const hidden = digest.store.hiddenSet();
  const all = digest.store.postsForThreads(keys).filter(p => !hidden.has(`${p.source}:${p.postId}`));
  const posts = all.slice(0, MAX_STORY_POSTS).map(it => shape(maskItem(it))).sort((x, y) => x.time - y.time);
  return {
    posts,
    threads: keys.length,
    totalThreads: (d.payload.threads || []).length,
    truncated: all.length > MAX_STORY_POSTS,
    analysis: d.payload.analysis ?? null,
  };
}

async function handleApi(req, res, url, rawParts) {
  const safe = url.searchParams.get("safe") !== "0";
  const parts = rawParts.map(decodeURIComponent);
  const [, a, b, c] = parts; // parts[0] is "api"

  if (a === "sources") return json(res, 200, await registry.describe());

  if (a === "admin" && b === "reports") {
    if (!adminAllowed(req.headers["x-admin-token"])) return json(res, process.env.ADMIN_TOKEN ? 401 : 503, { error: process.env.ADMIN_TOKEN ? "Not authorised" : "Admin is off. Set ADMIN_TOKEN." });
    const status = c === "dismissed" || c === "actioned" ? c : "open";
    return json(res, 200, { reports: digest.store.listReports(status) });
  }

  // Digest pages are masked when they are built, so they are not switched by Safe mode.
  if (a === "digest") {
    if (!b) {
      const since = Math.floor(Date.now() / 1000) - 48 * 3600;
      const items = digest.store.listDigests(since).map(({ payload, ...rest }) => ({
        ...rest,
        reason: payload.reason ?? null,
        // Thread keys in this story, so the home page can link its rows to the story.
        members: (payload.threads || []).map(t => `${t.source}:${t.threadId}`),
      }));
      return json(res, 200, { aiEnabled: llm.enabled(), job: digest.status(), items });
    }
    if (!ID_RE.test(b)) return json(res, 400, { error: "Bad story id" });
    const d = digest.store.getDigest(b);
    if (!d) return json(res, 404, { error: "Story not found" });
    if (c === "posts") return json(res, 200, storyPosts(d));
    return json(res, 200, d);
  }

  // Threads posted in the last week, older than a day. Masked the same way as the latest feed.
  if (a === "past") {
    const now = Math.floor(Date.now() / 1000);
    const items = digest.store.rootsBetween(now - 7 * 86400, now - 86400);
    return json(res, 200, applySafe(items, safe));
  }

  if (a === "latest") return json(res, 200, applySafe(await latest(), safe));

  if (a === "search") {
    const source = url.searchParams.get("source") || "";
    const q = (url.searchParams.get("q") || "").trim();
    const adapter = registry.get(source);
    if (!adapter || !adapter.search) return json(res, 400, { error: "This source does not support search" });
    if (q.length < 2 || q.length > 100) return json(res, 400, { error: "Query must be 2 to 100 characters" });
    return json(res, 200, applySafe(await adapter.search(q), safe));
  }

  // /api/:source/:community[/:threadId]
  const adapter = registry.get(a);
  if (!adapter) return json(res, 404, { error: "Source not available" });
  if (!(await registry.hasCommunity(a, b))) return json(res, 404, { error: "Community not available" });

  if (!c) return json(res, 200, applySafe(await adapter.fetchRecent(b, 60), safe));
  if (!ID_RE.test(c)) return json(res, 400, { error: "Bad thread id" });
  const hidden = digest.store.hiddenSet();
  const posts = (await adapter.fetchThread(b, c)).filter(p => !hidden.has(`${a}:${p.postId}`));
  return json(res, 200, applySafe(posts, safe));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const rawParts = url.pathname.split("/").filter(Boolean); // split before decoding so %2F stays inside a community id
  try {
    if (rawParts[0] === "api" && req.method === "POST") return await handlePost(req, res, rawParts);
    if (rawParts[0] === "api") return await handleApi(req, res, url, rawParts);

    // Static files
    const pageName = rawParts.map(decodeURIComponent).join("/");
    const rel = !pageName ? "index.html" : pageName === "admin" ? "admin.html" : pageName;
    const file = path.resolve(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    const status = err.status && err.status >= 400 && err.status < 600 ? 502 : 500;
    console.error(err);
    json(res, status, { error: err.message || "Request failed" });
  }
});

server.listen(PORT, () => console.log(`Nice Chan running at http://localhost:${PORT}`));
