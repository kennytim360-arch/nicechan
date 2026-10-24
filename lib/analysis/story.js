// Per-story statistics, with no model. Inputs are cached items: threads (roots) and their comments.
// Output is plain data the UI can show, and every number can be traced back to posts with links.
const { topWords, tokens } = require("./words");
const mood = require("./mood");
const { linksOf } = require("./links");
const { columnKey } = require("../digest/frame");

const HOUR = 3600;
const WINDOW_HOURS = 6;

function excerpt(text, n = 200) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function analyseStory({ threads, posts, now = Math.floor(Date.now() / 1000) }) {
  const all = posts.length ? posts : threads;
  const titleWords = new Set(threads.flatMap(t => tokens(t.title || "")));
  const byForum = new Map();
  for (const p of all) {
    const key = columnKey(p);
    if (!byForum.has(key)) byForum.set(key, []);
    byForum.get(key).push(p);
  }

  const forums = [...byForum.entries()].map(([key, list]) => {
    const roots = threads.filter(t => columnKey(t) === key);
    const scores = roots.map(t => t.score).filter(s => typeof s === "number");
    const authors = new Map();
    for (const p of list) if (p.author) authors.set(p.author, (authors.get(p.author) || 0) + 1);
    const recent = list.filter(p => now - p.time < WINDOW_HOURS * HOUR).length;
    const before = list.filter(p => now - p.time >= WINDOW_HOURS * HOUR && now - p.time < 2 * WINDOW_HOURS * HOUR).length;
    // A comment only: the thread's own post is not a comment, so it cannot be the most upvoted one.
    const scored = list.filter(p => typeof p.score === "number" && p.postId !== p.threadId);
    const top = scored.sort((a, b) => b.score - a.score)[0] ?? null;
    const texts = list.map(p => `${p.title || ""} ${p.text || ""}`);
    return {
      key,
      source: list[0].source,
      threads: roots.length,
      posts: list.length,
      points: scores.length ? scores.reduce((a, b) => a + b, 0) : null,
      lastPost: Math.max(...list.map(p => p.time)),
      topPosters: [...authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([author, count]) => ({ author, count })),
      growth: { last6h: recent, prev6h: before },
      topWords: topWords(texts, { n: 8, skip: titleWords }),
      mood: mood.average(texts),
      topComment: top ? { author: top.author || "Anonymous", score: top.score, excerpt: excerpt(top.text, 240), url: top.url } : null,
    };
  });

  // Links that more than one forum points to.
  const linkForums = new Map();
  for (const p of all) {
    for (const l of linksOf(p)) {
      if (!linkForums.has(l)) linkForums.set(l, { forums: new Set(), threads: new Set() });
      const e = linkForums.get(l);
      e.forums.add(columnKey(p));
      if (threads.some(t => t.postId === p.postId)) e.threads.add(p.postId);
    }
  }
  const sharedLinks = [...linkForums.entries()]
    .filter(([, e]) => e.forums.size >= 2)
    .map(([url, e]) => ({ url, forums: [...e.forums], threads: e.threads.size }))
    .sort((a, b) => b.forums.length - a.forums.length);

  return {
    forums: forums.sort((a, b) => b.posts - a.posts),
    sharedLinks,
    words: topWords(all.map(p => `${p.title || ""} ${p.text || ""}`), { n: 12, skip: titleWords }),
    mood: mood.average(all.map(p => `${p.title || ""} ${p.text || ""}`)),
    counts: { threads: threads.length, posts: all.length, forums: forums.length },
  };
}

module.exports = { analyseStory, excerpt };
