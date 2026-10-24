// Manifold Markets adapter, using the public v0 API.
// Listing: newest markets. Thread: one market plus its comments.
const http = require("../http");
const { item } = require("../normalize");
const { htmlToText } = require("../text");

const BASE = "https://api.manifold.markets/v0";
const TITLES = { markets: "Newest markets" };

const meta = {
  id: "manifold",
  name: "Manifold Markets",
  short: "Manifold",
  homepage: "https://manifold.markets",
  terms: "https://manifold.markets/terms",
  api: "https://docs.manifold.markets/api",
};

function marketFields(m) {
  return {
    title: m.question,
    text: htmlToText(m.textDescription ?? ""),
    author: m.creatorName,
    time: Math.floor((m.createdTime ?? 0) / 1000),
    url: m.url,
    score: null,
    meta: {
      probability: typeof m.probability === "number" ? m.probability : null,
      volume: m.volume ?? null,
      traders: m.uniqueBettorCount ?? null,
      closeTime: m.closeTime ?? null,
      isResolved: !!m.isResolved,
    },
  };
}

function create(cfg = {}) {
  const communities = cfg.communities ?? ["markets"];

  return {
    meta,

    async listCommunities() {
      return communities.map(c => ({ source: "manifold", community: c, title: TITLES[c] ?? c }));
    },

    async fetchRecent(community, limit = 25) {
      if (!communities.includes(community)) throw new Error(`manifold: unknown community ${community}`);
      const markets = await http.getJSON(`${BASE}/markets?limit=${Math.min(limit, 100)}`, { ttl: 60_000 });
      return markets.map(m =>
        item({ source: "manifold", community, threadId: m.id, postId: m.id, parentId: null, ...marketFields(m) })
      );
    },

    async fetchThread(community, id) {
      const mid = encodeURIComponent(id);
      const [market, comments] = await Promise.all([
        http.getJSON(`${BASE}/market/${mid}`, { ttl: 60_000 }),
        http.getJSON(`${BASE}/comments?contractId=${mid}&limit=100`, { ttl: 60_000 }),
      ]);
      const out = [item({ source: "manifold", community, threadId: id, postId: id, parentId: null, ...marketFields(market) })];
      for (const c of comments) {
        const body = c.text ?? "";
        if (!body) continue;
        out.push(
          item({
            source: "manifold",
            community,
            threadId: id,
            postId: c.id,
            parentId: c.replyToCommentId ?? id,
            author: c.userName,
            time: Math.floor((c.createdTime ?? 0) / 1000),
            title: "",
            text: body,
            url: market.url,
            score: null,
            meta: {},
          })
        );
      }
      return out;
    },
  };
}

module.exports = { create, meta };
