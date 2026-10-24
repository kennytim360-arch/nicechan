// Lemmy adapter, using each instance's public /api/v3 endpoints.
// Only the communities listed in config.json are reachable. Community ids look like "programming.dev/technology".
// NSFW posts are skipped.
const http = require("../http");
const { item } = require("../normalize");
const { stripMarkdown, isoToUnix } = require("../text");

const meta = {
  id: "lemmy",
  name: "Lemmy",
  short: "Lemmy",
  homepage: "https://join-lemmy.org",
  terms: "https://join-lemmy.org/docs/",
  api: "https://join-lemmy.org/api/",
};

function create(cfg = {}) {
  const instances = (cfg.instances ?? []).map(i => ({ base: i.base.replace(/\/$/, ""), host: new URL(i.base).host, communities: i.communities ?? [] }));
  const idCache = new Map();

  function resolve(community) {
    const slash = community.indexOf("/");
    const host = community.slice(0, slash);
    const name = community.slice(slash + 1);
    const inst = instances.find(i => i.host === host && i.communities.includes(name));
    if (!inst) throw new Error(`lemmy: community ${community} is not configured`);
    return { base: inst.base, name };
  }

  async function communityId(base, name) {
    const key = `${base}|${name}`;
    if (!idCache.has(key)) {
      const d = await http.getJSON(`${base}/api/v3/community?name=${encodeURIComponent(name)}`, { ttl: 3_600_000 });
      idCache.set(key, d.community_view.community.id);
    }
    return idCache.get(key);
  }

  function postItem(v, community) {
    const p = v.post;
    return item({
      source: "lemmy",
      community,
      threadId: p.id,
      postId: p.id,
      parentId: null,
      author: v.creator?.name,
      time: isoToUnix(p.published),
      title: p.name,
      text: stripMarkdown(p.body),
      // ap_id points at the post on the instance where it was created, so it is the true original.
      url: p.ap_id,
      score: v.counts?.score ?? null,
      thumb: p.thumbnail_url || null,
      meta: { replies: v.counts?.comments ?? 0, externalUrl: p.url || null },
    });
  }

  return {
    meta,

    async listCommunities() {
      return instances.flatMap(i =>
        i.communities.map(name => ({
          source: "lemmy",
          community: `${i.host}/${name}`,
          title: `${name}@${i.host}`,
        }))
      );
    },

    async fetchRecent(community, limit = 25) {
      const { base, name } = resolve(community);
      const id = await communityId(base, name);
      const d = await http.getJSON(
        `${base}/api/v3/post/list?community_id=${id}&sort=New&type_=All&limit=${Math.min(limit, 50)}`,
        { ttl: 60_000 }
      );
      return d.posts.filter(v => !v.post.nsfw && !v.post.deleted && !v.post.removed).map(v => postItem(v, community));
    },

    async fetchThread(community, postId) {
      const { base } = resolve(community);
      const [post, comments] = await Promise.all([
        http.getJSON(`${base}/api/v3/post?id=${encodeURIComponent(postId)}`, { ttl: 60_000 }),
        http.getJSON(
          `${base}/api/v3/comment/list?post_id=${encodeURIComponent(postId)}&sort=Top&type_=All&max_depth=8&limit=50`,
          { ttl: 60_000 }
        ),
      ]);
      const out = [postItem(post.post_view, community)];
      for (const cv of comments.comments) {
        const c = cv.comment;
        if (c.removed || c.deleted) continue;
        // path is "0.<root>.<...>.<self>". The parent is the second-to-last id, or the post itself for top-level comments.
        const path = String(c.path || "0").split(".").map(Number);
        const parent = path.length > 2 ? String(path[path.length - 2]) : String(postId);
        out.push(
          item({
            source: "lemmy",
            community,
            threadId: postId,
            postId: c.id,
            parentId: parent,
            author: cv.creator?.name,
            time: isoToUnix(c.published),
            title: "",
            text: stripMarkdown(c.content),
            url: c.ap_id,
            score: cv.counts?.score ?? null,
            meta: {},
          })
        );
      }
      return out;
    },
  };
}

module.exports = { create, meta };
