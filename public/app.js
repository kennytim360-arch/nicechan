// Nice Chan UI, laid out from design/*.dc.html. Hash routes:
//   #/                            hot: newest threads ordered by activity (home)
//   #/new                         new: threads by time
//   #/past                        past: threads from the last week, older than a day
//   #/s/<source>                  one source's threads
//   #/<source>/<community>        one community's threads
//   #/<source>/<community>/<id>   one thread
//   #/digest                      stories that span sources
//   #/digest/<id>                 one story
//   #/sources  #/about  #/login
// Safe mode is applied by the server. Masked words arrive as markers and show as buttons.
(() => {
  const $ = s => document.querySelector(s);
  const view = $("#view");
  const boards = $("#boards");
  const safeBtn = $("#safe");
  const searchBtn = $("#search-toggle");
  const searchBox = $("#search-box");
  const filterInput = $("#filter");

  const MASK_RE = /\uE000([^\uE000\uE001]*)\uE001/g; // server's masked-word markers
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const PAGE = 50;
  const COLORS = { hn: "#E4600A", "4chan": "#AF0A0F", lemmy: "#0A7C8F", manifold: "#6A47E0", lesswrong: "#3A7A1E", eaforum: "#2B5FA8" };
  const ABOUT = {
    hn: "Technology, startups and science. Threaded comments, mostly from people who work in tech.",
    "4chan": "Anonymous imageboard. Fast, blunt, full of jokes. Only work-safe boards are read, with rude words and images blurred.",
    lemmy: "Reddit-style communities on many independent servers. Nice Chan reads only the communities it is configured for.",
    manifold: "A prediction market where people bet play money on whether things will happen.",
    lesswrong: "A forum about reasoning, decisions and AI, with long careful posts.",
    eaforum: "A forum about effective altruism: research, donations and careers.",
  };
  const MASCOT = [
    "    ,---------.    ",
    "   /  ^     ^  \\   ",
    "  |      \\_/    |  ",
    "   \\    nice!   /   ",
    "    `---------'    ",
  ].join("\n");

  const state = {
    sources: [],
    items: [],
    stories: new Map(), // "source:threadId" -> story id, for the "AI rundown" links
    digests: [],
    showStories: false,
    mode: "list",
    token: 0,
    safe: localStorage.getItem("safe") !== "0",
  };

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const enc = encodeURIComponent;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const host = u => { try { return new URL(u).host; } catch { return ""; } };
  const ago = ts => {
    const s = Date.now() / 1000 - ts;
    const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (s < 60) return "just now";
    if (m < 60) return plural(m, "minute", "minutes") + " ago";
    if (h < 24) return plural(h, "hour", "hours") + " ago";
    return plural(d, "day", "days") + " ago";
  };
  // Design timestamp: 10/24/26(Sat)02:30:41
  const stamp = ts => {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${p(d.getFullYear() % 100)}(${DAYS[d.getDay()]})${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const snippet = (t, n = 110) => {
    const s = (t || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  };
  const srcMeta = id => state.sources.find(s => s.id === id);
  const srcName = id => srcMeta(id)?.name ?? id;
  const srcShort = id => srcMeta(id)?.short ?? id;
  const srcColor = id => COLORS[id] ?? "#000";
  const commTitle = (src, comm) => srcMeta(src)?.communities.find(c => c.community === comm)?.title ?? comm;
  const tag = id => `<span class="sq" style="color:${srcColor(id)}">&#9632;</span> [${esc(srcShort(id))}]`;
  // Column label for a digest column key: "hn", "lemmy", or "4chan/g".
  const columnName = key => {
    const [src, comm] = key.split("/");
    if (src === "4chan" && comm) return `/${comm}/ ${commTitle("4chan", comm)}`;
    return srcName(src);
  };
  // Word-list mood, as a label. The score is rough: it is a tilt, not a verdict.
  const moodLabel = v => {
    if (v === null || v === undefined) return "no scored words";
    const word = v > 0.15 ? "positive" : v < -0.15 ? "negative" : "neutral";
    return `${word} (${v > 0 ? "+" : ""}${v.toFixed(2)})`;
  };

  // Escape, then turn masked-word markers into buttons. Pressing one turns Safe mode off to read the word.
  const inline = raw => esc(raw)
    .replace(MASK_RE, '<button type="button" class="mask" data-reveal="1" title="Hidden by Safe mode. Press to turn Safe mode off.">$1</button>')
    .replace(/&gt;&gt;(\d+)/g, '<span class="quote" data-no="$1">&gt;&gt;$1</span>');

  // Body text: one paragraph per line. ">" lines are greentext (italic, per the design).
  const bodyHTML = raw => {
    const text = (raw || "").replace(/\r/g, "").replace(/\n\s*\n+/g, "\n").trim();
    if (!text) return "";
    return text.split("\n").map(line => {
      const greentext = /^>(?!>)/.test(line);
      return `<p class="${greentext ? "greentext" : ""}">${inline(line)}</p>`;
    }).join("");
  };

  // [report] on every post. The server rate-limits reports per visitor.
  const reportLink = p => `<button type="button" class="act report" data-source="${esc(p.source)}" data-post="${esc(p.postId)}">[report]</button>`;

  async function api(path, params = {}) {
    const q = new URLSearchParams({ safe: state.safe ? "1" : "0", ...params });
    const r = await fetch(`/api${path}?${q}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }

  function parse() {
    return location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(p => {
      try { return decodeURIComponent(p); } catch { return p; }
    });
  }

  // ----- Row 1: source bracket list -----
  function renderBoards() {
    const links = [`<a href="#/">all</a>`].concat(state.sources.map(s => `<a href="#/s/${enc(s.id)}">${esc(s.short)}</a>`));
    boards.innerHTML = "[" + links.join(" / ") + "]";
  }

  // ----- Thread rows (hot, new, past, source and community listings) -----
  function storyRow(it, i) {
    const m = it.meta ?? {};
    const hot = (it.score ?? 0) >= 100 || (m.replies ?? 0) >= 100;
    const fresh = Date.now() / 1000 - it.time < 3600;
    const badge = hot ? "[HOT!]" : fresh ? "[NEW!]" : "";
    const domain = m.externalUrl ? host(m.externalUrl) : host(it.url);
    const points = it.score != null ? `${esc(it.score)} points ` : "";
    const threadHref = `#/${enc(it.source)}/${enc(it.community)}/${enc(it.threadId)}`;
    const storyId = state.stories.get(`${it.source}:${it.threadId}`);
    const rundown = storyId ? ` | <a href="#/digest/${enc(storyId)}"><b>AI rundown</b></a>` : "";
    return `
      <div class="trow">
        <div class="c-title">
          <div><span class="rank">${i + 1}.</span> <span aria-hidden="true">&#9650;</span> <a class="story-title" href="${threadHref}">${esc(it.title || snippet(it.text) || "(no title)")}</a> <span class="badge-tag">${badge}</span></div>
          <div class="story-meta">(${esc(domain)}) ${points}${it.author ? `by ${esc(it.author)}, ` : ""}${esc(ago(it.time))}${rundown} | <a href="${threadHref}">read thread</a></div>
        </div>
        <div class="c-forums"><span class="sq" style="color:${srcColor(it.source)}">&#9632;</span> ${esc(srcName(it.source))}</div>
        <div class="c-replies">${m.replies != null ? esc(m.replies) : "–"}</div>
        <div class="c-views">–</div>
        <div class="c-last">${esc(ago(it.time))}<br>by <b>${esc(it.author || "Anonymous")}</b></div>
      </div>`;
  }

  // A story that spans forums, as one row: every forum it draws from is listed.
  function mergedRow(st, i) {
    const forums = st.sources.map(s => `<span class="sq" style="color:${srcColor(s)}">&#9632;</span> ${esc(srcName(s))}`).join("<br>");
    return `
      <div class="trow merged${st.rare ? " rare-row" : ""}">
        <div class="c-title">
          <div><span class="rank">${i + 1}.</span> <span class="badge-tag">[STORY]</span> <a class="story-title" href="#/digest/${enc(st.id)}">${esc(st.label)}</a>${st.rare ? ` <span class="rare">[RARE: ${esc(st.rare)}]</span>` : ""}</div>
          <div class="story-meta">${esc(plural(st.itemCount, "thread", "threads"))} across ${esc(plural(st.sources.length, "forum", "forums"))} | <a href="#/digest/${enc(st.id)}"><b>read the story</b></a></div>
        </div>
        <div class="c-forums">${forums}</div>
        <div class="c-replies">–</div>
        <div class="c-views">–</div>
        <div class="c-last">${esc(ago(st.lastTime))}</div>
      </div>`;
  }

  function tableHTML(items, stories = []) {
    if (!items.length && !stories.length) return `<p class="empty">Nothing to show here.</p>`;
    const rows = stories.map(mergedRow).concat(items.map(storyRow));
    return `
      <div class="table">
        <div class="trow thead" aria-hidden="true">
          <div>Story</div><div>Forums</div><div class="c-replies">Replies</div><div class="c-views">Views</div><div>Last post</div>
        </div>
        ${rows.join("")}
      </div>`;
  }

  function applyFilter() {
    const q = filterInput.value.trim().toLowerCase();
    const matches = it => `${it.title} ${it.text} ${it.author} ${it.url}`.toLowerCase().includes(q);
    let items = q ? state.items.filter(matches) : state.items;
    let stories = [];
    if (state.showStories) {
      // Threads that belong to a merged story appear in that story's row instead.
      if (!q) items = items.filter(it => !state.stories.has(`${it.source}:${it.threadId}`));
      stories = (state.digests || []).filter(st => st.sources.length >= 2 && (!q || st.label.toLowerCase().includes(q)));
    }
    const holder = $("#table-holder");
    if (holder) holder.innerHTML = tableHTML(items, stories);
    const count = $("#count");
    if (count) count.textContent = q ? `${items.length + stories.length} shown` : "";
  }

  // Fetches the stories once, so rows can link to them.
  async function loadStories() {
    try {
      const d = await api("/digest");
      state.digests = d.items;
      state.stories = new Map();
      for (const s of d.items) for (const m of s.members) state.stories.set(m, s.id);
    } catch {
      state.stories = new Map();
    }
  }

  // ----- Pages -----
  async function showList(token, { path, title, sort, source }) {
    const data = await api(path);
    if (token !== state.token) return;
    await loadStories();
    if (token !== state.token) return;
    let items = data.items ?? data;
    if (source) items = items.filter(it => it.source === source);
    if (sort === "hot") items = items.slice().sort((a, b) => ((b.score ?? 0) + (b.meta?.replies ?? 0)) - ((a.score ?? 0) + (a.meta?.replies ?? 0)));
    state.items = items;
    state.showStories = !source && (sort === "hot" || sort === "new");
    state.mode = "list";
    document.title = `${title} · Nice Chan`;
    const notice = data.errors?.length
      ? `<p class="note">Some sources did not respond: ${data.errors.map(e => esc(`${srcShort(e.source)} ${e.community}`)).join(", ")}.</p>`
      : "";
    const banner = !source && title === "Nice Chan" ? `
      <div class="banner">
        <div class="mascot" role="img" aria-label="Nice Chan mascot, a smiling round face"><pre>${esc(MASCOT)}</pre></div>
        <h1>/news/ - The World, All at Once</h1>
        <div class="rule" aria-hidden="true"></div>
      </div>
      <div class="greentext-intro">
        <div>&gt;be you</div>
        <div>&gt;want to know what the internet is actually saying</div>
        <div>&gt;read every forum at once, minus the slurs</div>
      </div>` : "";
    view.innerHTML = `
      ${banner}
      <p class="count-line" id="count"></p>
      ${notice}
      <div id="table-holder"></div>`;
    applyFilter();
  }

  async function showListing(source, community, token) {
    const items = await api(`/${enc(source)}/${enc(community)}`);
    if (token !== state.token) return;
    await loadStories();
    state.items = items;
    state.mode = "list";
    const title = commTitle(source, community);
    document.title = `${title} · ${srcName(source)} · Nice Chan`;
    view.innerHTML = `
      <h2 class="page-title">${tag(source)} ${esc(title)}</h2>
      <p class="count-line" id="count"></p>
      <div id="table-holder"></div>`;
    applyFilter();
  }

  async function showThread(source, community, id, token) {
    const posts = await api(`/${enc(source)}/${enc(community)}/${enc(id)}`);
    if (token !== state.token) return;
    await loadStories();
    state.mode = "page";
    const op = posts[0];
    const m = op.meta ?? {};
    const title = op.title || snippet(op.text, 90) || `Thread ${id}`;
    const domain = m.externalUrl ? host(m.externalUrl) : host(op.url);
    const replies = Math.max(posts.length - 1, 0);
    const storyId = state.stories.get(`${source}:${id}`);
    document.title = `${title} · ${srcShort(source)} · Nice Chan`;

    // Depth from parent links. A reply to the thread root is flat (depth 0), which suits 4chan's flat threads.
    const depth = new Map([[op.postId, -1]]);
    const rows = posts.slice(1).map(p => {
      const parent = p.parentId ?? op.postId;
      const d = parent === op.postId ? 0 : Math.min((depth.get(parent) ?? 0) + 1, 3);
      depth.set(p.postId, d);
      return { p, d };
    });

    const postBox = (p, d, isOp) => {
      const img = p.thumb && /^https:\/\//.test(p.thumb)
        ? `<div class="thumb${state.safe ? " blurred" : ""} post-thumb"><img loading="lazy" referrerpolicy="no-referrer" src="${esc(p.thumb)}" alt=""></div>`
        : "";
      const full = p.meta?.full && /^https:\/\//.test(p.meta.full)
        ? `<a class="post-full" href="${esc(p.meta.full)}" target="_blank" rel="noopener noreferrer">[full image ↗]</a>`
        : "";
      return `
        <div class="post-wrap" id="p${esc(p.postId)}" style="margin-left:${d * 24}px">
          <span class="gutter" aria-hidden="true">&gt;&gt;</span>
          <article class="post">
            <header class="post-head">
              <span class="name">${esc(p.author || "Anonymous")}</span>
              <span>${tag(p.source)}</span>
              <span>${esc(stamp(p.time))}</span>
              <span>No.${esc(p.postId)}${isOp ? " (OP)" : ""}</span>
              <a class="orig" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">[original ↗]</a>
              ${reportLink(p)}
            </header>
            ${img}${full}
            <div class="post-body">${bodyHTML(p.text)}</div>
          </article>
        </div>`;
    };

    view.innerHTML = `
      <div class="thread-head">
        <div><a href="#/${enc(source)}/${enc(community)}">[back to ${esc(commTitle(source, community))}]</a></div>
        <div class="title">${inline(title)} <span class="domain">(${esc(domain)})</span></div>
        <div class="info">${tag(source)} ${esc(srcName(source))} | ${esc(plural(replies, "comment", "comments"))} | ${esc(ago(op.time))}${storyId ? ` | <a href="#/digest/${enc(storyId)}"><b>AI rundown</b></a>` : ""} | <a href="${esc(op.url)}" target="_blank" rel="noopener noreferrer">[original ↗]</a>${m.externalUrl ? ` | <a href="${esc(m.externalUrl)}" target="_blank" rel="noopener noreferrer">[article ↗]</a>` : ""}</div>
      </div>
      <h2 class="comments-h">&gt;comments</h2>
      <div class="eq" aria-hidden="true">${"=".repeat(160)}</div>
      ${postBox(op, 0, true)}
      ${rows.map(({ p, d }) => postBox(p, d, false)).join("")}`;
    window.scrollTo({ top: 0 });
  }

  // ----- Digest -----
  async function showDigestList(token) {
    const d = await api("/digest");
    if (token !== state.token) return;
    state.mode = "page";
    document.title = "Stories · Nice Chan";
    const rows = d.items.map(st => `
      <div class="trow${st.rare ? " rare-row" : ""}">
        <div class="c-title">
          <div>${st.rare ? `<span class="rare">[RARE: ${esc(st.rare)}]</span> ` : ""}<a class="story-title" href="#/digest/${enc(st.id)}">${esc(st.label)}</a></div>
          <div class="story-meta">${st.status === "ready" ? "[AI rundown]" : "[analysis]"}</div>
        </div>
        <div class="c-forums">${st.sources.map(s => `<span class="sq" style="color:${srcColor(s)}">&#9632;</span> ${esc(srcName(s))}`).join("<br>")}</div>
        <div class="c-replies">${esc(plural(st.itemCount, "thread", "threads"))}</div>
        <div class="c-views">–</div>
        <div class="c-last">${esc(ago(st.lastTime))}</div>
      </div>`).join("");
    view.innerHTML = `
      <h2 class="page-title">&gt;stories</h2>
      <div class="table">
        <div class="trow thead" aria-hidden="true"><div>Story</div><div>Forums</div><div class="c-replies">Threads</div><div class="c-views">Views</div><div>Last update</div></div>
        ${rows || `<p class="empty">No shared stories yet.</p>`}
      </div>`;
  }

  // Forum table from the analysis: threads, posts, growth, top words, mood, top comment, top posters.
  function forumBlock(f) {
    const g = f.growth ?? { last6h: 0, prev6h: 0 };
    const posters = (f.topPosters || []).map(x => `${esc(x.author)} (${x.count})`).join(", ") || "–";
    const words = (f.topWords || []).map(w => `${esc(w.word)} (${w.count})`).join(", ") || "–";
    const top = f.topComment
      ? `<blockquote>&ldquo;${esc(f.topComment.excerpt)}&rdquo; by ${esc(f.topComment.author)}, ▲ ${esc(f.topComment.score)} <a href="${esc(f.topComment.url)}" target="_blank" rel="noopener noreferrer">[original ↗]</a></blockquote>`
      : `<p class="muted-line">This forum does not give comment scores.</p>`;
    return `
      <section class="forum-block">
        <p><b>${esc(columnName(f.key))}</b></p>
        <p>${esc(plural(f.threads, "thread", "threads"))}, ${esc(plural(f.posts, "post", "posts"))}${f.points != null ? `, ▲ ${esc(f.points)} points` : ""}. Last post ${esc(ago(f.lastPost))}.</p>
        <p>Growth: ${esc(g.last6h)} posts in the last 6 hours, ${esc(g.prev6h)} in the 6 hours before.</p>
        <p>Mood (word list, rough): ${esc(moodLabel(f.mood))}</p>
        <p>Most posting: ${posters}</p>
        <p>Words used most: ${words}</p>
        <p>Most upvoted comment:</p>
        ${top}
      </section>`;
  }

  async function showDigestStory(id, token) {
    const [d, replies] = await Promise.all([api(`/digest/${enc(id)}`), api(`/digest/${enc(id)}/posts`).catch(e => ({ error: e.message }))]);
    if (token !== state.token) return;
    state.mode = "page";
    const p = d.payload;
    const a = p.analysis;
    const ready = d.status === "ready";
    document.title = `${d.label} · Stories · Nice Chan`;
    const rare = d.rare ? ` <span class="rare">[RARE: ${esc(d.rare)}]</span>` : "";
    const forums = d.sources.map(s => `<span class="sq" style="color:${srcColor(s)}">&#9632;</span> ${esc(srcName(s))}`).join(" ");
    const shownReplies = replies.posts ? replies.posts.length : 0;

    // Automatic summary, built from the numbers. It contains no model output.
    const autoSummary = a
      ? `${plural(a.counts.threads, "thread", "threads")} and ${plural(a.counts.posts, "post", "posts")} across ${plural(a.counts.forums, "forum", "forums")}.` +
        (a.words.length ? ` Words used most: ${a.words.slice(0, 5).map(w => w.word).join(", ")}.` : "") +
        (a.sharedLinks.length ? ` ${plural(a.sharedLinks.length, "link is", "links are")} shared by more than one forum.` : "")
      : "";

    const sharedList = a && a.sharedLinks.length
      ? `<p><b>Shared links</b></p><ul>${a.sharedLinks.map(l => `<li>${esc(l.url)} <span class="muted-line">(${l.forums.map(f => esc(columnName(f))).join(", ")})</span></li>`).join("")}</ul>`
      : "";

    const aiBlock = ready ? `
      <p><b>AI summary</b> (${esc(p.model)}, ${esc(stamp(p.generatedAt))})</p>
      <p>${esc(p.summary)}</p>
      <p><b>Common ground.</b> ${esc(p.commonGround)}${p.minorityNote ? ` <b>${esc(p.minorityNote)}</b>` : ""}</p>
      <p><b>Where they split</b></p>
      <ol>${(p.disagreements || []).map(x => `<li><b>${esc(x.topic)}</b><ul>${Object.entries(x.sides || {}).map(([k, v]) => `<li>${esc(columnName(k))}: ${esc(v)}</li>`).join("")}</ul></li>`).join("")}</ol>` : "";

    const forumsHTML = a ? a.forums.map(forumBlock).join("") : "";
    const explain = `
      ${a ? `<p><b>Forum by forum</b></p>${forumsHTML}${sharedList}` : `<p>No analysis yet.</p>`}
      ${aiBlock}
      ${!ready ? `<p class="muted-line">AI framing is off. Add ANTHROPIC_API_KEY to .env to add it.</p>` : ""}`;

    const replyList = replies.error
      ? `<p class="note">Could not load the comments: ${esc(replies.error)}</p>`
      : renderReplies(replies);

    view.innerHTML = `
      <div class="titlebar">
        <span class="titletext">${esc(d.label)}</span>${rare}
        <span class="domain">(${esc(d.sources.map(srcShort).join(", "))})</span>
      </div>
      <div class="info">${forums} | ${esc(plural(shownReplies, "reply", "replies"))} | views – | <a href="#/digest">[return]</a> <a href="#bottom">[bottom]</a> <button type="button" class="act" id="update">[update]</button></div>

      <article class="post op-ai">
        <header class="post-head">
          <span class="name">Nice Chan [${ready ? "AI summary" : "summary"}]</span>
          <span>No.1 (OP)</span>
        </header>
        <div class="post-body">
          <p>${esc(ready ? p.summary : autoSummary)}</p>
          <details class="explain">
            <summary>[+] Explain it to me</summary>
            ${explain}
          </details>
          <p class="ai-note">${ready ? "AI-generated. Check the sources." : "Built from counts and word lists. No AI was used."}</p>
        </div>
      </article>

      <div class="bar-black" id="replies-bar">Replies</div>
      <div class="filters" role="group" aria-label="Filter replies">
        ${[["all", "all"], ["hn", "Hacker News"], ["lemmy", "Lemmy"], ["4chan", "4chan"], ["nicechan", "Nice Chan"]].map(([k, label]) =>
          `<button type="button" class="act filter" data-filter="${k}" aria-pressed="${k === "all"}">[${esc(label)}]</button>`).join(" ")}
      </div>
      <div id="replies">${replyList}</div>
      <div id="bottom"></div>`;

    $("#update").addEventListener("click", () => route());
    view.querySelectorAll("button.filter").forEach(b => b.addEventListener("click", () => {
      view.querySelectorAll("button.filter").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      replyFilter = b.dataset.filter;
      replyPage = 1;
      const holder = $("#replies");
      if (holder && replies.posts) holder.innerHTML = renderReplies(replies);
    }));
    window.scrollTo({ top: 0 });
  }

  let replyFilter = "all";
  let replyPage = 1;

  // Story comments: all of them in time order, paged. Nice Chan replies are not built yet, so that filter is empty.
  function renderReplies(r) {
    if (!r.posts) return "";
    const list = r.posts.filter(p => replyFilter === "all" || (replyFilter === "nicechan" ? false : p.source === replyFilter));
    const shown = list.slice(0, replyPage * PAGE);
    const more = list.length > shown.length
      ? `<p><button type="button" class="act" id="more">[load more: ${list.length - shown.length} left]</button></p>` : "";
    const trunc = r.truncated ? `<p class="note">Showing the first 600 comments.</p>` : "";
    const boxes = shown.map(p => `
      <div class="post-wrap" id="p${esc(p.postId)}">
        <span class="gutter" aria-hidden="true">&gt;&gt;</span>
        <article class="post">
          <header class="post-head">
            <span class="name">${esc(p.author || "Anonymous")}</span>
            <span>${tag(p.source)}</span>
            <span>${esc(stamp(p.time))}</span>
            <span>No.${esc(p.postId)}</span>
            <a class="orig" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">[original ↗]</a>
            ${reportLink(p)}
          </header>
          <div class="post-body">${bodyHTML(p.text)}</div>
        </article>
      </div>`).join("");
    const empty = !shown.length ? `<p class="empty">No replies from this source.</p>` : "";
    queueMicrotask(() => {
      const b = $("#more");
      if (b) b.onclick = () => { replyPage++; const h = $("#replies"); if (h) h.innerHTML = renderReplies(r); };
    });
    return trunc + boxes + empty + more;
  }

  function showSources() {
    state.mode = "page";
    document.title = "Sources · Nice Chan";
    view.innerHTML = `
      <h2 class="page-title">&gt;sources</h2>
      <div class="sources">
        ${state.sources.map((s, i) => `
          <section class="src-row" style="background:${i % 2 ? "var(--lime-alt)" : "var(--lime)"}">
            <div class="src-name"><span class="sq" style="color:${srcColor(s.id)}">&#9632;</span> ${esc(s.name)}</div>
            <div class="src-about">${esc(ABOUT[s.id] ?? "")}</div>
            ${s.error ? `<p class="src-about">Unavailable right now.</p>` : ""}
            <ul class="src-list">
              ${s.communities.map(c => `<li><a href="#/${enc(s.id)}/${enc(c.community)}">${esc(c.title)}</a></li>`).join("")}
            </ul>
          </section>`).join("")}
      </div>`;
  }

  function showAbout() {
    state.mode = "page";
    document.title = "About · Nice Chan";
    view.innerHTML = `
      <h2 class="page-title">&gt;about</h2>
      <div class="about-body">
        <p>Nice Chan reads public discussions from several forums side by side.</p>
        <p>Every thread and comment links to its original. Only excerpts are shown.</p>
        <p>Safe mode is on by default. Rude words are hidden and images are blurred until clicked.</p>
        <p>Summaries and counts are labelled. AI-generated text is labelled as AI.</p>
      </div>`;
  }

  function showLogin() {
    state.mode = "page";
    document.title = "Login · Nice Chan";
    view.innerHTML = `<h2 class="page-title">&gt;login</h2><p class="about-body">Accounts are not available yet.</p>`;
  }

  function showError(msg) {
    view.innerHTML = `
      <div class="error">
        <h2>Couldn’t load this</h2>
        <p>${esc(msg)}</p>
        <p><button class="act" id="retry" type="button">[try again]</button></p>
      </div>`;
    $("#retry").onclick = () => route();
  }

  async function route() {
    const token = ++state.token;
    const parts = parse();
    const [first, second, third] = parts;
    searchBox.hidden = searchBtn.getAttribute("aria-expanded") !== "true";
    view.innerHTML = '<p class="loading">Loading…</p>';
    try {
      if (!first || first === "hot") await showList(token, { path: "/latest", title: "Nice Chan", sort: "hot" });
      else if (first === "new") await showList(token, { path: "/latest", title: "New · Nice Chan", sort: "new" });
      else if (first === "past") await showList(token, { path: "/past", title: "Past · Nice Chan" });
      else if (first === "s" && second) await showList(token, { path: "/latest", title: `${srcName(second)} · Nice Chan`, source: second });
      else if (first === "digest") {
        if (second) await showDigestStory(second, token);
        else await showDigestList(token);
      }
      else if (first === "sources") showSources();
      else if (first === "about") showAbout();
      else if (first === "login") showLogin();
      else if (!srcMeta(first) || !second) throw new Error("This page does not exist.");
      else if (!third) await showListing(first, second, token);
      else await showThread(first, second, third, token);
    } catch (e) {
      if (token === state.token) showError(e.message);
    }
  }

  // ----- Controls -----
  function setSafe(on) {
    state.safe = on;
    localStorage.setItem("safe", on ? "1" : "0");
    safeBtn.setAttribute("aria-pressed", String(on));
    safeBtn.innerHTML = `safe mode: <b>${on ? "on" : "off"}</b>`;
  }
  safeBtn.addEventListener("click", () => { setSafe(!state.safe); route(); });

  searchBtn.addEventListener("click", () => {
    const open = searchBtn.getAttribute("aria-expanded") !== "true";
    searchBtn.setAttribute("aria-expanded", String(open));
    searchBox.hidden = !open;
    if (open) filterInput.focus();
    else { filterInput.value = ""; applyFilter(); }
  });
  filterInput.addEventListener("input", () => { if (state.mode === "list") applyFilter(); });

  // Clicks: masked words (turn Safe mode off), blurred images, quote jumps, and reports.
  document.addEventListener("click", async e => {
    if (e.target.closest("[data-reveal]")) { setSafe(false); route(); return; }
    const thumb = e.target.closest(".thumb.blurred");
    if (thumb) { thumb.classList.remove("blurred"); return; }
    const rep = e.target.closest("button.report");
    if (rep) {
      rep.disabled = true;
      try {
        const r = await fetch("/api/report", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: rep.dataset.source, postId: rep.dataset.post, reason: "reported by a visitor" }),
        });
        const d = await r.json().catch(() => ({}));
        rep.textContent = r.ok ? "[reported]" : `[${d.error || "not sent"}]`;
      } catch {
        rep.textContent = "[not sent]";
        rep.disabled = false;
      }
      return;
    }
    const q = e.target.closest(".quote");
    if (q) {
      const post = document.getElementById("p" + q.dataset.no);
      if (!post) { q.title = "That comment is not in this thread"; return; }
      post.scrollIntoView({ behavior: "smooth", block: "center" });
      post.classList.remove("flash");
      void post.offsetWidth;
      post.classList.add("flash");
    }
  });

  // Init
  setSafe(state.safe);
  if (!location.hash) history.replaceState(null, "", "#/");
  addEventListener("hashchange", route);
  fetch("/api/sources")
    .then(r => r.json())
    .then(sources => { state.sources = sources; renderBoards(); })
    .catch(() => { boards.textContent = "[sources unavailable]"; })
    .finally(route);
})();
