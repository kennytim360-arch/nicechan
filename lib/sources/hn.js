// Hacker News adapter.
// Listings: official Firebase API (hacker-news.firebaseio.com/v0).
// Threads: Algolia HN Search API (hn.algolia.com/api/v1/items/:id) returns the whole comment tree in one call.
// Search: Algolia HN Search API (hn.algolia.com/api/v1/search).
const http = require("../http");
const { item } = require("../normalize");
const { htmlToText } = require("../text");

const FIREBASE = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA = "https://hn.algolia.com/api/v1";
const HN = "https://news.ycombinator.com";
const TITLES = { top: "Top stories", new: "New stories" };

const meta = {
  id: "hn",
  name: "Hacker News",
  short: "HN",
  homepage: HN,
  terms: "https://www.ycombinator.com/legal/",
};

const discussionUrl = id => `${HN}/item?id=${id}`;

function storyItem(s, community) {
  return item({
    source: "hn",
    community,
    threadId: s.id,
    postId: s.id,
    parentId: null,
    author: s.by,
    time: s.time,
    title: s.title,
    text: htmlToText(s.text),
    url: discussionUrl(s.id),
    score: s.score,
    thumb: null,
    meta: { replies: s.descendants ?? 0, externalUrl: s.url || null },
  });
}

// Flattens an Algolia item tree. Deleted comments (text null) are skipped, but their replies are kept.
function flattenTree(root, community) {
  const out = [
    item({
      source: "hn",
      community,
      threadId: root.id,
      postId: root.id,
      parentId: null,
      author: root.author,
      time: root.created_at_i,
      title: root.title,
      text: htmlToText(root.text),
      url: discussionUrl(root.id),
      score: root.points,
      meta: { replies: countDescendants(root), externalUrl: root.url || null },
    }),
  ];
  const walk = (nodes, parentId) => {
    for (const c of nodes || []) {
      if (c.text == null) {
        walk(c.children, parentId);
        continue;
      }
      out.push(
        item({
          source: "hn",
          community,
          threadId: root.id,
          postId: c.id,
          parentId,
          author: c.author,
          time: c.created_at_i,
          title: "",
          text: htmlToText(c.text),
          url: discussionUrl(c.id),
          score: null,
          meta: {},
        })
      );
      walk(c.children, c.id);
    }
  };
  walk(root.children, root.id);
  return out;
}

function countDescendants(node) {
  let n = 0;
  for (const c of node.children || []) n += 1 + countDescendants(c);
  return n;
}

function create(cfg = {}) {
  const communities = cfg.communities ?? ["top", "new"];
  return {
    meta,

    async listCommunities() {
      return communities.map(c => ({ source: "hn", community: c, title: TITLES[c] ?? c }));
    },

    async fetchRecent(community, limit = 20) {
      if (!communities.includes(community)) throw new Error(`hn: unknown community ${community}`);
      const ids = await http.getJSON(`${FIREBASE}/${community}stories.json`, { ttl: 60_000 });
      const picked = ids.slice(0, limit);
      const stories = await Promise.all(
        picked.map(id => http.getJSON(`${FIREBASE}/item/${id}.json`, { ttl: 120_000 }).catch(() => null))
      );
      return stories
        .filter(s => s && s.type === "story" && !s.dead && !s.deleted)
        .map(s => storyItem(s, community));
    },

    async fetchThread(community, id) {
      const tree = await http.getJSON(`${ALGOLIA}/items/${encodeURIComponent(id)}`, { ttl: 60_000 });
      return flattenTree(tree, community);
    },

    async search(query, limit = 20) {
      const q = encodeURIComponent(query);
      const d = await http.getJSON(`${ALGOLIA}/search?query=${q}&tags=story&hitsPerPage=${limit}`, { ttl: 300_000 });
      return d.hits.map(h =>
        item({
          source: "hn",
          community: "search",
          threadId: h.objectID,
          postId: h.objectID,
          parentId: null,
          author: h.author,
          time: h.created_at_i,
          title: h.title,
          text: "",
          url: discussionUrl(h.objectID),
          score: h.points,
          meta: { replies: h.num_comments ?? 0, externalUrl: h.url || null },
        })
      );
    },
  };
}

module.exports = { create, meta, flattenTree, storyItem };
