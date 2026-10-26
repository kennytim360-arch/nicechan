// Digest pipeline. Stories are groups of threads about the same event, found by shared links and keyword overlap.
// A story needs threads from at least two sources.
// Every story gets a statistics analysis from its cached posts (no model needed). When ANTHROPIC_API_KEY is set,
// the model also frames each community. Without the key the story status is "analysed".
const { createHash } = require("crypto");
const { cluster } = require("./cluster");
const { groupByCommunity, frameCluster, consensus } = require("./frame");
const { maskPlain, stillRude } = require("../filter");
const { excerpt } = require("../text");
const { analyseStory } = require("../analysis/story");
const llm = require("./llm");

const WINDOW_HOURS = 48;   // stories are built from threads this recent
const MIN_NEW_ITEMS = 3;   // re-run the model only when a story gains this many threads
const MAX_STORY_THREADS = 8; // comments are cached for at most this many threads per story
// Bump when the stored shape or the column rules change. Older stories are rebuilt on the next run.
const PAYLOAD_VERSION = 5;
const RARE = { communities: ["4chan/x"], label: "rare combo" };

// An author with four or more threads in one forum is a bulk poster (for example a market maker's dozens of markets). Their threads are not stories.
// 4chan's "Anonymous" is not one person, so it is never counted.
function dropBulkPosters(items) {
  const counts = new Map();
  for (const it of items) {
    if (!it.author || it.author === "Anonymous") continue;
    const key = `${it.source}:${it.author}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return items.filter(it => !it.author || it.author === "Anonymous" || (counts.get(`${it.source}:${it.author}`) || 0) < 4);
}

// Stable id: the earliest member's source and postId. It changes only if that member leaves the window.
function storyId(items) {
  const first = items.reduce((a, b) => (b.time < a.time ? b : a));
  return createHash("sha1").update(`${first.source}:${first.postId}`).digest("hex").slice(0, 12);
}

// A story is rare when it spans 2+ sources and includes a community listed in RARE.communities (currently /x/ on 4chan).
function rareFlag(group) {
  const hit = group.items.some(it => RARE.communities.includes(`${it.source}/${it.community}`));
  return hit && group.sources.length >= 2 ? RARE.label : null;
}

function rawView(groups) {
  return groups.map(g => ({
    key: g.key,
    source: g.source,
    community: g.community,
    count: g.count,
    threads: g.items.slice(0, 5).map(it => ({
      postId: it.postId,
      title: maskPlain(it.title || ""),
      excerpt: maskPlain(excerpt(it.text || "", 280)),
      author: it.author || "Anonymous",
      time: it.time,
      replies: it.meta?.replies ?? null,
      url: it.url,
    })),
  }));
}

// Story title: never a 4chan title while another forum has one. Otherwise the most-replied title, tagged with its source.
// Returns { label, labelSource }. labelSource is null when the label came from a non-4chan forum.
function pickLabel(items) {
  const byReplies = (a, b) => (b.meta?.replies ?? 0) - (a.meta?.replies ?? 0) || b.time - a.time;
  const titled = items.filter(it => it.title);
  const others = titled.filter(it => it.source !== "4chan").sort(byReplies);
  if (others.length) return { label: maskPlain(others[0].title), labelSource: null };
  const any = titled.sort(byReplies)[0];
  if (any) return { label: maskPlain(any.title), labelSource: `${any.source}/${any.community}` };
  return { label: "Untitled story", labelSource: null };
}

async function refresh({
  store,
  env = process.env,
  now = Math.floor(Date.now() / 1000),
  maxFramesPerRun = 5,
  fetchThreadPosts = null, // async (source, community, threadId) => items; caches comments into the store
}) {
  const items = dropBulkPosters(store.itemsSince(now - WINDOW_HOURS * 3600));
  const stories = cluster(items).filter(g => g.sources.length >= 2);
  const report = { stories: stories.length, framed: 0, analysed: 0, kept: 0, errors: 0 };
  const aiOn = llm.enabled(env);
  const hidden = store.hiddenSet();
  let frames = 0;

  for (const g of stories.sort((a, b) => b.items.length - a.items.length)) {
    const id = storyId(g.items);
    const groups = groupByCommunity(g.items);
    const prev = store.getDigest(id);
    const { label, labelSource } = pickLabel(g.items);
    // A story whose title still reads as rude after masking is held back, not shown.
    if (stillRude(label)) {
      report.held = (report.held || 0) + 1;
      continue;
    }
    const base = {
      id,
      label,
      sources: g.sources,
      itemCount: g.items.length,
      firstTime: Math.min(...g.items.map(i => i.time)),
      lastTime: Math.max(...g.items.map(i => i.time)),
      updatedAt: now,
      rare: rareFlag(g),
    };
    const raw = rawView(groups);
    const threads = g.items.map(it => ({ source: it.source, community: it.community, threadId: it.threadId, title: maskPlain(it.title || excerpt(it.text || "", 80)), url: it.url, replies: it.meta?.replies ?? 0, score: it.score ?? null, time: it.time }));

    // Cache this story's comments, then analyse from the cache.
    const keys = g.items.slice(0, MAX_STORY_THREADS).map(it => ({ source: it.source, community: it.community, threadId: it.threadId }));
    if (fetchThreadPosts) {
      for (const k of keys) {
        try {
          store.upsertItems(await fetchThreadPosts(k.source, k.community, k.threadId), now);
        } catch {
          // A thread that fails to load keeps whatever was cached before.
        }
      }
    }
    const posts = store.postsForThreads(keys).filter(p => !hidden.has(`${p.source}:${p.postId}`));
    const analysis = analyseStory({ threads: g.items, posts, now });

    // Already framed and no meaningful new threads: keep the framing, refresh the analysis and raw view.
    if (prev?.status === "ready" && prev.payload.version === PAYLOAD_VERSION && g.items.length - prev.itemCount < MIN_NEW_ITEMS) {
      store.saveDigest({ ...base, status: "ready", payload: { ...prev.payload, labelSource, raw, analysis, threads, updatedAt: now } });
      report.kept++;
      continue;
    }
    if (!aiOn) {
      store.saveDigest({ ...base, status: "analysed", payload: { version: PAYLOAD_VERSION, labelSource, threads, raw, analysis, reason: null } });
      report.analysed++;
      continue;
    }
    if (frames >= maxFramesPerRun) {
      store.saveDigest({ ...base, status: "analysed", payload: { version: PAYLOAD_VERSION, labelSource, threads, raw, analysis, reason: "AI framing queued for the next run" } });
      report.analysed++;
      continue;
    }

    frames++;
    try {
      const framed = await frameCluster(label, groups, { env });
      const agree = await consensus(label, framed.communities.map(c => ({ ...groups.find(g2 => g2.key === c.community), ...c, key: c.community })), { env });
      store.saveDigest({
        ...base,
        status: "ready",
        payload: {
          version: PAYLOAD_VERSION,
          labelSource,
          threads,
          raw,
          analysis,
          summary: maskPlain(framed.summary),
          communities: framed.communities.map(c => ({
            key: c.community,
            claims: c.claims.map(maskPlain),
            tone: maskPlain(c.tone),
            blame: maskPlain(c.blame),
            quotes: c.quotes.map(q => {
              const g2 = groups.find(x => x.key === c.community);
              const it = g2.items.find(x => String(x.postId) === String(q.postId));
              return { postId: String(q.postId), quote: maskPlain(q.quote), url: it?.url ?? null };
            }),
          })),
          commonGround: agree.commonGround,
          commonGroundScore: agree.commonGroundScore,
          disagreements: agree.disagreements,
          minorityCarried: agree.minorityCarried,
          minorityNote: agree.minorityNote,
          model: framed.model ?? llm.config(env).model,
          provider: framed.provider ?? "hosted",
          generatedAt: now,
        },
      });
      report.framed++;
    } catch (err) {
      store.saveDigest({ ...base, status: "error", payload: { version: PAYLOAD_VERSION, labelSource, threads, raw, analysis, reason: err.message } });
      report.errors++;
    }
  }
  report.removed = store.pruneDigests(now);
  return report;
}

module.exports = { refresh, storyId, rareFlag, rawView, pickLabel, RARE, WINDOW_HOURS, MAX_STORY_THREADS };
