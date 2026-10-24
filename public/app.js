// Nice Chan UI. Hash routes:
//   #/                         Latest across sources
//   #/<source>/<community>     one community's listing (community ids are URL-encoded)
//   #/<source>/<community>/<id>  one thread
// Safe mode is applied by the server (masked words never reach the browser while it is on).
(() => {
  const $ = s => document.querySelector(s);
  const view = $("#view");
  const nav = $("#boards");
  const search = $("#search");
  const safeBox = $("#safe");
  const themeBtn = $("#theme");
  const sidebar = $("#sidebar");
  const scrim = $("#scrim");
  const menuBtn = $("#menu");

  const state = { sources: [], items: [], mode: "latest", key: null, token: 0 };
  const MASK_RE = /([^]*)/g; // server's masked-word markers

  const store = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const enc = encodeURIComponent;
  const isSafe = () => safeBox.checked;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const when = ts => (ts ? new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
  const ago = ts => {
    const s = Date.now() / 1000 - ts;
    const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (s < 60) return "just now";
    if (m < 60) return `${m}m ago`;
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  };
  const snippet = (t, n = 220) => {
    const s = (t || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  };
  const host = u => { try { return new URL(u).host; } catch { return ""; } };

  const sourceMeta = id => state.sources.find(s => s.id === id);
  const shortName = id => sourceMeta(id)?.short ?? id;
  const communityTitle = (src, comm) => sourceMeta(src)?.communities.find(c => c.community === comm)?.title ?? comm;

  // Titles and snippets: escaped, with masked words shown as masked spans.
  const renderPlain = raw => esc(raw || "").replace(MASK_RE, '<span class="nc-mask" title="Hidden by Safe mode. Turn Safe mode off to read.">$1</span>');

  // Full post body: greentext, line breaks, and >>N quote links.
  const renderBody = raw => {
    const text = (raw || "").replace(/\r/g, "").replace(/\n\s*\n+/g, "\n");
    const html = esc(text)
      .replace(/^(&gt;.*)$/gm, '<span class="greentext">$1</span>')
      .replace(/\n/g, "<br>")
      .replace(MASK_RE, '<span class="nc-mask" title="Hidden by Safe mode. Turn Safe mode off to read.">$1</span>');
    return html.replace(/&gt;&gt;(\d+)/g, '<a href="#" class="quote" data-no="$1">&gt;&gt;$1</a>');
  };

  const mediaHTML = p => {
    if (!p.thumb || !/^https:\/\//.test(p.thumb)) return "";
    const blur = isSafe() ? " blurred" : "";
    const full = p.meta?.full && /^https:\/\//.test(p.meta.full)
      ? `<a class="full-link" href="${esc(p.meta.full)}" target="_blank" rel="noopener noreferrer">Open full image ↗</a>`
      : "";
    return `<div class="media"><div class="thumb${blur}"><img loading="lazy" referrerpolicy="no-referrer" src="${esc(p.thumb)}" alt=""></div>${full}</div>`;
  };

  function postHTML(p, op) {
    return `
      <article class="post${op ? " op" : ""}" id="p${esc(p.postId)}">
        <header class="post-head">
          <span class="name">${esc(p.author)}</span>
          <time datetime="${new Date(p.time * 1000).toISOString()}">${esc(when(p.time))}</time>
          <a class="orig" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" title="Open the original on ${esc(shortName(p.source))}">${esc(shortName(p.source))} ↗</a>
        </header>
        <div class="post-body">
          ${mediaHTML(p)}
          ${p.text ? `<div class="text">${renderBody(p.text)}</div>` : ""}
        </div>
      </article>`;
  }

  function rowHTML(it) {
    const meta = it.meta ?? {};
    const heading = it.title || snippet(it.text, 110) || "(no text)";
    const sub = it.title ? snippet(it.text) : "";
    const parts = [];
    if (it.score != null) parts.push(`<span>▲ <b>${esc(it.score)}</b></span>`);
    if (meta.replies != null) parts.push(`<span><b>${esc(meta.replies)}</b> ${meta.replies === 1 ? "reply" : "replies"}</span>`);
    if (meta.images != null) parts.push(`<span><b>${esc(meta.images)}</b> ${meta.images === 1 ? "image" : "images"}</span>`);
    if (typeof meta.probability === "number") parts.push(`<span><b>${Math.round(meta.probability * 100)}%</b> yes</span>`);
    if (meta.externalUrl) parts.push(`<span>${esc(host(meta.externalUrl))}</span>`);
    parts.push(`<span>${esc(ago(it.time))}</span>`);
    return `
    <li>
      <a class="thread-row" href="#/${enc(it.source)}/${enc(it.community)}/${enc(it.threadId)}">
        <div class="row-thumb${isSafe() ? " blur" : ""}">${it.thumb && /^https:\/\//.test(it.thumb) ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(it.thumb)}" alt="">` : ""}</div>
        <div class="row-main">
          <div class="row-source"><span class="badge">${esc(shortName(it.source))}</span><span class="muted">${esc(communityTitle(it.source, it.community))}</span></div>
          <div class="row-title">${renderPlain(heading)}</div>
          ${sub ? `<div class="row-snippet">${renderPlain(sub)}</div>` : ""}
          <div class="row-meta">${parts.join('<span class="dot">·</span>')}</div>
        </div>
      </a>
    </li>`;
  }

  async function api(path, params = {}) {
    const q = new URLSearchParams({ safe: isSafe() ? "1" : "0", ...params });
    const r = await fetch(`/api${path}?${q}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }

  function parse() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(p => {
      try { return decodeURIComponent(p); } catch { return p; }
    });
    return { source: parts[0] ?? null, community: parts[1] ?? null, id: parts[2] ?? null };
  }

  function markActive(key) {
    nav.querySelectorAll("[data-key]").forEach(a => a.classList.toggle("active", a.dataset.key === key));
  }

  function renderNav() {
    const sections = state.sources.map(s => `
      <section class="nav-group">
        <div class="nav-head">
          <span>${esc(s.name)}</span>
          ${s.error ? '<em class="warn" title="' + esc(s.error) + '">unavailable</em>' : ""}
        </div>
        ${s.communities.map(c => `
          <a class="board-link" data-key="${esc(s.id)}/${esc(c.community)}" href="#/${enc(s.id)}/${enc(c.community)}">
            <span class="bname">${s.id === "4chan" ? `<b class="slash">/${esc(c.community)}/</b> ` : ""}${esc(c.title)}</span>
          </a>`).join("")}
      </section>`).join("");
    nav.innerHTML = `
      <a class="board-link latest" data-key="latest" href="#/">
        <span class="bname">Latest</span>
      </a>
      ${sections}`;
    markActive(state.key);
  }

  function drawList() {
    const count = $("#count");
    const list = $("#list");
    if (!count || !list) return;
    const q = search.value.trim().toLowerCase();
    const items = q
      ? state.items.filter(it => `${it.title} ${it.text} ${it.author}`.toLowerCase().includes(q))
      : state.items;
    count.textContent = q ? `${items.length} of ${state.items.length} shown` : plural(state.items.length, "item", "items");
    list.innerHTML = items.length ? items.map(rowHTML).join("") : `<li class="empty">Nothing matches “${esc(q)}”.</li>`;
  }

  const listShell = (title, sub, notice = "") => `
    <div class="content">
      <div class="view-head">
        <h2>${title}</h2>
        <p class="muted" id="count">${sub}</p>
      </div>
      ${notice}
      <ul class="threads" id="list"></ul>
    </div>`;

  async function showLatest(token) {
    const data = await api("/latest");
    if (token !== state.token) return;
    state.mode = "list";
    state.items = data.items;
    search.disabled = false;
    document.title = "Latest · Nice Chan";
    const notice = data.errors.length
      ? `<p class="notice">Some sources did not respond: ${data.errors.map(e => esc(`${shortName(e.source)} ${e.community}`)).join(", ")}.</p>`
      : "";
    view.innerHTML = listShell("Latest", "", notice);
    drawList();
  }

  async function showListing(source, community, token) {
    const items = await api(`/${enc(source)}/${enc(community)}`);
    if (token !== state.token) return;
    state.mode = "list";
    state.items = items;
    search.disabled = false;
    const title = communityTitle(source, community);
    document.title = `${title} · ${shortName(source)} · Nice Chan`;
    view.innerHTML = listShell(
      `<span class="badge">${esc(shortName(source))}</span> ${esc(title)}`,
      ""
    );
    drawList();
  }

  async function showThread(source, community, id, token) {
    const posts = await api(`/${enc(source)}/${enc(community)}/${enc(id)}`);
    if (token !== state.token) return;
    state.mode = "thread";
    search.value = "";
    search.disabled = true;
    const op = posts[0];
    const replies = Math.max(posts.length - 1, 0);
    const title = op.title || snippet(op.text, 90) || `Thread ${id}`;
    document.title = `${title} · ${shortName(source)} · Nice Chan`;

    const m = op.meta ?? {};
    const facts = [
      esc(communityTitle(source, community)),
      plural(replies, "reply", "replies"),
      op.score != null ? `▲ ${esc(op.score)}` : null,
      m.images != null ? plural(m.images, "image", "images") : null,
      typeof m.probability === "number" ? `${Math.round(m.probability * 100)}% yes` : null,
      esc(when(op.time)),
    ].filter(Boolean);
    const external = m.externalUrl
      ? ` · <a href="${esc(m.externalUrl)}" target="_blank" rel="noopener noreferrer">Read article on ${esc(host(m.externalUrl))} ↗</a>`
      : "";

    view.innerHTML = `
      <div class="content">
        <div class="thread-head">
          <a class="back" href="#/${enc(source)}/${enc(community)}">← ${esc(communityTitle(source, community))}</a>
          <h2 class="thread-title">${renderPlain(title)}</h2>
          <p class="attrib">
            From <b>${esc(shortName(source))}</b> · ${facts.join(" · ")}${external} ·
            <a href="${esc(op.url)}" target="_blank" rel="noopener noreferrer">View original ↗</a>
          </p>
        </div>
        <div class="posts">${posts.map((p, i) => postHTML(p, i === 0)).join("")}</div>
      </div>`;
    window.scrollTo({ top: 0 });
  }

  function showError(msg) {
    view.innerHTML = `
      <div class="content">
        <div class="error">
          <h2>Couldn’t load this</h2>
          <p class="muted">${esc(msg)}</p>
          <button class="btn" id="retry">Try again</button>
        </div>
      </div>`;
    $("#retry").onclick = () => route();
  }

  function openSidebar() { sidebar.classList.add("open"); scrim.classList.add("open"); }
  function closeSidebar() { sidebar.classList.remove("open"); scrim.classList.remove("open"); }

  async function route() {
    const token = ++state.token;
    const { source, community, id } = parse();
    const key = source ? `${source}/${community}` : "latest";
    if (key !== state.key) search.value = "";
    state.key = key;
    markActive(key);
    closeSidebar();
    view.innerHTML = '<div class="loading">Loading…</div>';
    try {
      if (!source) await showLatest(token);
      else if (!sourceMeta(source) || !community) throw new Error("This page does not exist.");
      else if (!id) await showListing(source, community, token);
      else await showThread(source, community, id, token);
    } catch (e) {
      if (token === state.token) showError(e.message);
    }
  }

  // Theme: system (default), light, or dark.
  const THEMES = ["system", "light", "dark"];
  let theme = store.get("theme", "system");
  if (!THEMES.includes(theme)) theme = "system";
  function applyTheme() {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    themeBtn.title = `Theme: ${theme}`;
  }
  themeBtn.addEventListener("click", () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    store.set("theme", theme);
    applyTheme();
  });

  // Safe mode: the server masks words; the client also blurs images until they are clicked.
  safeBox.checked = store.get("safe", "1") === "1";
  safeBox.addEventListener("change", () => {
    store.set("safe", safeBox.checked ? "1" : "0");
    route();
  });

  menuBtn.addEventListener("click", () => (sidebar.classList.contains("open") ? closeSidebar() : openSidebar()));
  scrim.addEventListener("click", closeSidebar);

  search.addEventListener("input", () => { if (state.mode === "list") drawList(); });
  search.addEventListener("keydown", e => {
    if (e.key === "Escape") { search.value = ""; drawList(); search.blur(); }
  });

  // Keyboard: "/" focuses the filter; Esc closes the sidebar or goes back to the listing.
  document.addEventListener("keydown", e => {
    const tag = document.activeElement?.tagName;
    const typing = tag === "INPUT" || tag === "TEXTAREA";
    if (e.key === "/" && !typing && !search.disabled) { e.preventDefault(); search.focus(); }
    if (e.key === "Escape" && !typing) {
      const p = parse();
      if (sidebar.classList.contains("open")) closeSidebar();
      else if (p.id) location.hash = `#/${enc(p.source)}/${enc(p.community)}`;
    }
  });

  // Click a blurred image to show it.
  document.addEventListener("click", e => {
    const t = e.target.closest(".thumb.blurred");
    if (t) t.classList.remove("blurred");
  });

  // Quote links jump to the post in the same thread.
  document.addEventListener("click", e => {
    const link = e.target.closest("a.quote");
    if (!link) return;
    e.preventDefault();
    const post = document.getElementById("p" + link.dataset.no);
    if (!post) { link.title = "That post is not in this thread"; return; }
    post.scrollIntoView({ behavior: "smooth", block: "center" });
    post.classList.remove("flash");
    void post.offsetWidth;
    post.classList.add("flash");
  });

  // Init
  applyTheme();
  if (!location.hash) history.replaceState(null, "", "#/");
  addEventListener("hashchange", route);
  fetch("/api/sources")
    .then(r => r.json())
    .then(sources => { state.sources = sources; renderNav(); })
    .catch(() => { nav.textContent = "Couldn’t load sources."; })
    .finally(route);
})();
