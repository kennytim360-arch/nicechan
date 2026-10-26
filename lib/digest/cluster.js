// Story grouping: threads about the same event, across sources and boards.
// Two rules only, both strict:
//   1. Threads that share a normalised article link (the link the thread is about, meta.externalUrl) are the same story.
//      Links written inside comments are not used: they point at tools, videos and assets, not at the news.
//   2. Two threads are joined by keywords only when they share at least MIN_SHARED rare words.
//      A rare word appears in a few threads in the window, so common words ("game", "chapter", "wrong") never link threads.
// Threads that match neither rule stay alone. Callers keep only groups from 2+ sources, so nothing is invented across forums.
const { normalizeUrl } = require("../analysis/links");

const MIN_SHARED = 3;     // rare words two threads must share
const RARE_MIN = 2;       // a word must appear in at least this many threads to link any of them
const RARE_FRACTION = 0.002; // ...and in at most max(RARE_MIN_CAP, this share) of the window's threads
const RARE_MIN_CAP = 4;
const MAX_GROUP = 12;     // no keyword merge may create a story bigger than this, so links cannot chain forever

const STOP = new Set((
  "the and for are but not you your with this that from have has had was were will would can could should " +
  "what when where which who why how about into than then they them their there here just more most some only " +
  "also over under after before while said says make made does did doing get got its the amp quot nbsp gt lt " +
  "any all one two out off our his her she him who whom been being like also much many such too very " +
  "anyone someone everyone new news year years today yesterday week"
).split(/\s+/));

function stem(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

// Title counts twice so headline words weigh more than body words.
function terms(item) {
  const title = item.title || "";
  const body = (item.text || "").slice(0, 400);
  const raw = `${title} ${title} ${body}`.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/&[a-z#0-9]+;/g, " ");
  const out = new Set();
  for (const m of raw.matchAll(/[a-z][a-z0-9]{2,}/g)) {
    if (!STOP.has(m[0])) out.add(stem(m[0]));
  }
  return out;
}

// A link to a site's front page (no path) says nothing about one story.
const isFrontPage = l => /^[^/?]+\/$/.test(l);

// The article a thread is about, normalised, or null.
function articleLink(it) {
  const l = normalizeUrl(it.meta?.externalUrl || "");
  return l && !isFrontPage(l) ? l : null;
}

// Union-find over item indexes.
function unionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => { parent[find(a)] = find(b); };
  return { find, union };
}

// Returns groups of items. Each group has `items` and `sources` (distinct source ids).
function cluster(items) {
  const uf = unionFind(items.length);

  // Rule 1: shared normalised article link.
  const byLink = new Map();
  items.forEach((it, i) => {
    const l = articleLink(it);
    if (!l) return;
    if (byLink.has(l)) uf.union(i, byLink.get(l));
    else byLink.set(l, i);
  });

  // Rule 2: several shared rare words.
  const termSets = items.map(terms);
  const df = new Map();
  for (const set of termSets) for (const t of set) df.set(t, (df.get(t) || 0) + 1);
  const rareMax = Math.max(RARE_MIN_CAP, Math.round(items.length * RARE_FRACTION));
  const index = new Map();
  termSets.forEach((set, i) => {
    for (const t of set) {
      const n = df.get(t);
      if (n < RARE_MIN || n > rareMax) continue;
      if (!index.has(t)) index.set(t, []);
      index.get(t).push(i);
    }
  });
  const shared = new Map(); // "i,j" -> count of shared rare words
  for (const list of index.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const key = `${list[a]},${list[b]}`;
        shared.set(key, (shared.get(key) || 0) + 1);
      }
    }
  }
  // Strongest pairs first, so the most similar threads join first.
  const size = new Map(items.map((_, i) => [i, 1]));
  const sizeOf = i => size.get(uf.find(i));
  [...shared.entries()]
    .filter(([, n]) => n >= MIN_SHARED)
    .sort((x, y) => y[1] - x[1])
    .forEach(([key]) => {
      const [a, b] = key.split(",").map(Number);
      const ra = uf.find(a), rb = uf.find(b);
      if (ra === rb || sizeOf(a) + sizeOf(b) > MAX_GROUP) return;
      uf.union(ra, rb);
      size.set(uf.find(ra), sizeOf(a) + sizeOf(b));
    });

  const groups = new Map();
  items.forEach((it, i) => {
    const r = uf.find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it);
  });
  return [...groups.values()].map(grouped => ({
    items: grouped,
    sources: [...new Set(grouped.map(it => it.source))],
  }));
}

module.exports = { cluster, terms, MIN_SHARED };
