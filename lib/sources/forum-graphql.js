// LessWrong and EA Forum adapter. Both run the same ForumMagnum GraphQL schema, so one module serves both.
// Endpoint: POST {base}/graphql. Listing: posts(view). Thread: post plus comments(postCommentsTop).
const http = require("../http");
const { item } = require("../normalize");
const { htmlToText } = require("../text");

const SITES = {
  lesswrong: { name: "LessWrong", short: "LessWrong", base: "https://www.lesswrong.com" },
  eaforum: { name: "EA Forum", short: "EA Forum", base: "https://forum.effectivealtruism.org" },
};

const POST_FIELDS = "_id title pageUrl postedAt baseScore commentCount user { displayName } htmlBody";

function makeMeta(site) {
  const s = SITES[site];
  return { id: site, name: s.name, short: s.short, homepage: s.base, terms: s.base, api: `${s.base}/graphql` };
}

function createForum(site, cfg = {}) {
  const s = SITES[site];
  if (!s) throw new Error(`unknown forum site ${site}`);
  const communities = cfg.communities ?? ["new", "top"];
  const meta = makeMeta(site);

  async function gql(query, variables, ttl = 60_000) {
    const r = await http.postJSON(`${s.base}/graphql`, { query, variables }, { ttl });
    if (r.errors) throw new Error(`${site}: ${r.errors[0]?.message ?? "graphql error"}`);
    return r.data;
  }

  function postItem(p, community, threadId) {
    return item({
      source: site,
      community,
      threadId: threadId ?? p._id,
      postId: p._id,
      parentId: null,
      author: p.user?.displayName,
      time: Math.floor(Date.parse(p.postedAt) / 1000) || 0,
      title: p.title,
      text: htmlToText(p.htmlBody),
      url: p.pageUrl,
      score: p.baseScore ?? null,
      thumb: null,
      meta: { replies: p.commentCount ?? 0 },
    });
  }

  return {
    meta,

    async listCommunities() {
      return communities.map(c => ({ source: site, community: c, title: c === "new" ? "Newest posts" : "Top posts" }));
    },

    async fetchRecent(community, limit = 25) {
      if (!communities.includes(community)) throw new Error(`${site}: unknown community ${community}`);
      // The limit is inlined: the EA Forum server ignores a $limit variable and returns every post.
      const n = Math.max(1, Math.min(Math.floor(limit), 50));
      const d = await gql(
        `query { posts(input: { terms: { view: "${community}", limit: ${n} } }) { results { ${POST_FIELDS} } } }`,
        {}
      );
      return d.posts.results.map(p => postItem(p, community));
    },

    async fetchThread(community, id) {
      const d = await gql(
        `query($id: String!) {
           post(input: { selector: { _id: $id } }) { result { ${POST_FIELDS} } }
           comments(input: { terms: { view: "postCommentsTop", postId: $id, limit: 500 } }) {
             results { _id parentCommentId postId pageUrl postedAt baseScore user { displayName } htmlBody }
           }
         }`,
        { id },
        30_000
      );
      const root = postItem(d.post.result, community);
      const out = [root];
      for (const c of d.comments.results) {
        out.push(
          item({
            source: site,
            community,
            threadId: id,
            postId: c._id,
            parentId: c.parentCommentId ?? id,
            author: c.user?.displayName,
            time: Math.floor(Date.parse(c.postedAt) / 1000) || 0,
            title: "",
            text: htmlToText(c.htmlBody),
            url: c.pageUrl,
            score: c.baseScore ?? null,
            meta: {},
          })
        );
      }
      return out;
    },
  };
}

module.exports = { createForum, SITES };
