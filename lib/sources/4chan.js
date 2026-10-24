// 4chan adapter, using the read-only JSON API at a.4cdn.org.
// Boards: "worksafe" (default) means every board 4chan marks work-safe (ws_board = 1), minus `exclude`.
// Boards 4chan marks not work-safe are never used. Rate limit: 1 request per second, enforced by lib/http.js.
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
  const wanted = cfg.boards ?? "worksafe";
  const exclude = new Set(cfg.exclude ?? []);
  let boardInfo = null; // Map board -> { title, ws }

  async function loadBoards() {
    if (!boardInfo) {
      const d = await http.getJSON(`${API}/boards.json`, { ttl: 3_600_000 });
      boardInfo = new Map(d.boards.map(b => [b.board, { title: b.title, ws: b.ws_board === 1 }]));
    }
    return boardInfo;
  }

  // The boards this instance may read: an explicit list from config, or every work-safe board minus exclusions.
  async function allowedBoards() {
    const info = await loadBoards();
    const list = Array.isArray(wanted)
      ? wanted
      : [...info.entries()].filter(([, v]) => v.ws).map(([b]) => b);
    return list.filter(b => !exclude.has(b) && (!info.has(b) || info.get(b).ws));
  }

  async function assertBoard(board) {
    if (!/^[a-z0-9]{1,6}$/.test(board)) throw new Error(`4chan: invalid board ${board}`);
    if (!(await allowedBoards()).includes(board)) throw new Error(`4chan: board /${board}/ is not enabled`);
  }

  return {
    meta,

    async listCommunities() {
      const info = await loadBoards();
      return (await allowedBoards()).map(b => ({ source: "4chan", community: b, title: info.get(b)?.title ?? b }));
    },

    async fetchRecent(board, limit = 30) {
      await assertBoard(board);
      // One request per board. Conditional GETs (If-Modified-Since) are handled by lib/http.js.
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
      await assertBoard(board);
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
