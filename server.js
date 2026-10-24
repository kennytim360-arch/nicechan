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
const { startDigest } = require("./lib/digest/service");
const llm = require("./lib/digest/llm");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;

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

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

async function handleApi(req, res, url, rawParts) {
  const safe = url.searchParams.get("safe") !== "0";
  const parts = rawParts.map(decodeURIComponent);
  const [, a, b, c] = parts; // parts[0] is "api"

  if (a === "sources") return json(res, 200, await registry.describe());

  // Digest pages are masked when they are built, so they are not switched by Safe mode.
  if (a === "digest") {
    if (!b) {
      const since = Math.floor(Date.now() / 1000) - 48 * 3600;
      const items = digest.store.listDigests(since).map(({ payload, ...rest }) => ({ ...rest, reason: payload.reason ?? null }));
      return json(res, 200, { aiEnabled: llm.enabled(), job: digest.status(), items });
    }
    if (!ID_RE.test(b)) return json(res, 400, { error: "Bad story id" });
    const d = digest.store.getDigest(b);
    if (!d) return json(res, 404, { error: "Story not found" });
    return json(res, 200, d);
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
  return json(res, 200, applySafe(await adapter.fetchThread(b, c), safe));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const rawParts = url.pathname.split("/").filter(Boolean); // split before decoding so %2F stays inside a community id
  try {
    if (rawParts[0] === "api") return await handleApi(req, res, url, rawParts);

    // Static files
    const rel = rawParts.length ? rawParts.map(decodeURIComponent).join("/") : "index.html";
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
