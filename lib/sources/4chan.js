// 4chan adapter, using the read-only JSON API at a.4cdn.org.
// Only boards listed in config.json are reachable. Adult-only boards are not in the default list.
// Rate limit: 4chan asks for at most one request per second. lib/http.js enforces that for this host.
const http = require("../http");
const { item } = require("../normalize");
const { htmlToText } = require("../text");

const API = "https://a.4cdn.org";
const IMG = "https://i.4cdn.org";
const WEB = "https://boards.4chan.org";

const meta = {
  id: "4chan",
  name: "4chan",
  short: "4chan",
  homepage: "https://www.4chan.org",
  terms: "https://www.4chan.org/rules",
  api: "https://github.com/4chan/4chan-API",
};

function create(cfg = {}) {
  const boards = cfg.boards ?? [];
  let titles = null;

  async function boardTitles() {
    if (!titles) {
      try {
        const d = await http.getJSON(`${API}/boards.json`, { ttl: 3_600_000 });
        titles = Object.fromEntries(d.boards.map(b => [b.board, b.title]));
      } catch {
        titles = {};
      }
    }
    return titles;
  }

  function assertBoard(board) {
    if (!boards.includes(board)) throw new Error(`4chan: board /${board}/ is not enabled`);
  }

  return {
    meta,

    async listCommunities() {
      const t = await boardTitles();
      return boards.map(b => ({ source: "4chan", community: b, title: t[b] ?? b }));
    },

    async fetchRecent(board, limit = 30) {
      assertBoard(board);
      // The catalog is one request per board; conditional GETs (If-Modified-Since) are handled by lib/http.js.
      const pages = await http.getJSON(`${API}/${board}/catalog.json`, { ttl: 60_000 });
      return pages
        .flatMap(p => p.threads)
        .slice(0, limit)
        .map(t =>
          item({
            source: "4chan",
            community: board,
            threadId: t.no,
            postId: t.no,
            parentId: null,
            author: t.name,
            time: t.time,
            title: htmlToText(t.sub),
            text: htmlToText(t.com),
            url: `${WEB}/${board}/thread/${t.no}`,
            score: null,
            thumb: t.tim ? `${IMG}/${board}/${t.tim}s.jpg` : null,
            meta: {
              replies: t.replies,
              images: t.images,
              full: t.tim ? `${IMG}/${board}/${t.tim}${t.ext}` : null,
              sticky: !!t.sticky,
              closed: !!t.closed,
            },
          })
        );
    },

    async fetchThread(board, id) {
      assertBoard(board);
      const d = await http.getJSON(`${API}/${board}/thread/${encodeURIComponent(id)}.json`, { ttl: 30_000 });
      return d.posts.map(p =>
        item({
          source: "4chan",
          community: board,
          threadId: id,
          postId: p.no,
          // 4chan replies are flat: every reply sits directly under the thread. The OP has no parent.
          parentId: p.no === Number(id) ? null : id,
          author: p.name,
          time: p.time,
          title: htmlToText(p.sub),
          text: htmlToText(p.com),
          url: `${WEB}/${board}/thread/${id}#p${p.no}`,
          score: null,
          thumb: p.tim ? `${IMG}/${board}/${p.tim}s.jpg` : null,
          meta: { full: p.tim ? `${IMG}/${board}/${p.tim}${p.ext}` : null },
        })
      );
    },
  };
}

module.exports = { create, meta };
