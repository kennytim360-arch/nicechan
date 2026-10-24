// Story grouping: threads about the same event or topic, across sources and boards.
// Lexical TF-IDF over titles and the start of each text, then greedy centroid merging.
// This stands in for the embeddings step in AGENTS.md. It needs no API key or extra dependency.
// Swap `vectorize` for an embedding call later; the merging stays the same.

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
  const out = [];
  for (const m of raw.matchAll(/[a-z][a-z0-9]{2,}/g)) {
    if (!STOP.has(m[0])) out.push(stem(m[0]));
  }
  return out;
}

function vectorize(docs) {
  const df = new Map();
  for (const t of docs) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length;
  return docs.map(t => {
    const tf = new Map();
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    const v = new Map();
    let norm = 0;
    for (const [w, c] of tf) {
      const x = (1 + Math.log(c)) * (Math.log((N + 1) / (df.get(w) + 1)) + 1);
      v.set(w, x);
      norm += x * x;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [w, x] of v) v.set(w, x / norm);
    return v;
  });
}

function dot(a, b) {
  const [small, big] = a.size < b.size ? [a, b] : [b, a];
  let d = 0;
  for (const [w, x] of small) {
    const y = big.get(w);
    if (y) d += x * y;
  }
  return d;
}

function unit(m) {
  let n = 0;
  for (const x of m.values()) n += x * x;
  n = Math.sqrt(n) || 1;
  const out = new Map();
  for (const [w, x] of m) out.set(w, x / n);
  return out;
}

// Returns groups of items. Each group has `items`, and `sources` (distinct source ids).
// 0.4 was chosen on live titles: 0.3 joined unrelated threads, 0.4 kept clear stories.
function cluster(items, { threshold = 0.4, maxPasses = 6 } = {}) {
  const vecs = vectorize(items.map(terms));
  // Seed: threads that share a normalised link are the same story, so they start in one group.
  const { linksOf } = require("../analysis/links");
  const parent = items.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byLink = new Map();
  items.forEach((it, i) => {
    for (const l of linksOf(it)) {
      if (byLink.has(l)) parent[find(i)] = find(byLink.get(l));
      else byLink.set(l, i);
    }
  });
  const seeds = new Map();
  items.forEach((_, i) => {
    const r = find(i);
    if (!seeds.has(r)) seeds.set(r, { members: [], sum: new Map() });
    const g = seeds.get(r);
    g.members.push(i);
    for (const [t, x] of vecs[i]) g.sum.set(t, (g.sum.get(t) || 0) + x);
  });
  let groups = [...seeds.values()];

  for (let pass = 0; pass < maxPasses; pass++) {
    const norms = groups.map(g => unit(g.sum));
    // Inverted index over group centroids. Very common terms are skipped to keep pair counts small.
    const index = new Map();
    norms.forEach((v, gi) => {
      for (const t of v.keys()) {
        if (!index.has(t)) index.set(t, []);
        index.get(t).push(gi);
      }
    });
    const cap = Math.max(50, Math.floor(groups.length * 0.05));
    const seen = new Set();
    const pairs = [];
    for (const list of index.values()) {
      if (list.length > cap) continue;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          const key = a < b ? `${a},${b}` : `${b},${a}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const s = dot(norms[a], norms[b]);
          if (s >= threshold) pairs.push([s, a, b]);
        }
      }
    }
    if (!pairs.length) break;

    pairs.sort((x, y) => y[0] - x[0]);
    const used = new Set();
    const merged = [];
    for (const [, a, b] of pairs) {
      if (used.has(a) || used.has(b)) continue;
      used.add(a);
      used.add(b);
      const sum = new Map(groups[a].sum);
      for (const [t, x] of groups[b].sum) sum.set(t, (sum.get(t) || 0) + x);
      merged.push({ members: groups[a].members.concat(groups[b].members), sum });
    }
    groups = groups.filter((_, gi) => !used.has(gi)).concat(merged);
  }

  return groups.map(g => {
    const grouped = g.members.map(i => items[i]);
    return { items: grouped, sources: [...new Set(grouped.map(it => it.source))] };
  });
}

module.exports = { cluster, terms, vectorize, dot, unit };
