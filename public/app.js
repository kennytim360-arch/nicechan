// Nice Chan UI. Hash routes:
//   #/                            home: merged latest threads from every source
//   #/s/<source>                  latest threads from one source
//   #/sources                     source list
//   #/about                       about page
//   #/<source>/<community>        one community's threads
//   #/<source>/<community>/<id>   one thread
// Safe mode is applied by the server. Masked words arrive as markers and are shown as buttons.
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
  const COLORS = { hn: "#E4600A", "4chan": "#AF0A0F", lemmy: "#0A7C8F", manifold: "#6A47E0", lesswrong: "#3A7A1E", eaforum: "#2B5FA8" };
  const ABOUT = {
    hn: "Technology, startups and science. Threaded comments, mostly from people who work in tech.",
    "4chan": "Anonymous imageboard. Fast, blunt, full of jokes. Only a few boards are read, with rude words and images blurred.",
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
    items: [],        // rows for the current listing
    mode: "home",
    token: 0,
    safe: localStorage.getItem("safe") !== "0",
    crumb: "",
  };

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const enc = encodeURIComponent;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const host = u => { try { return new URL(u).host; } catch { return ""; } };
  const ago = ts => {
    const s = Date.now() / 1000 - ts;
    const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (s < 60) return "just now";
    if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
    if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
    return `${d} ${d === 1 ? "day" : "days"} ago`;
  };
  // Design timestamp: 10/24/26(Sat)02:30:41
  const stamp = ts => {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${p(d.getFullYear() % 100)}(${DAYS[d.getDay()]})${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const srcMeta = id => state.sources.find(s => s.id === id);
  const srcName = id => srcMeta(id)?.name ?? id;
  const srcShort = id => srcMeta(id)?.short ?? id;
  const srcColor = id => COLORS[id] ?? "#000";
  const commTitle = (src, comm) => srcMeta(src)?.communities.find(c => c.community === comm)?.title ?? comm;
  const tag = id => `<span class="sq" style="color:${srcColor(id)}">&#9632;</span> [${esc(srcShort(id))}]`;

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

  async function api(path, params = {}) {
    const q = new URLSearchParams({ safe: state.safe ? "1" : "0", ...params });
    const r = await fetch(`/api${path}?${q}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
    return d;
  }

  function parse() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(p => {
      try { return decodeURIComponent(p); } catch { return p; }
    });
    return parts;
  }

  // ----- Row 1 board list -----
  function renderBoards() {
    const links = [`<a href="#/">all</a>`].concat(
      state.sources.map(s => `<a href="#/s/${enc(s.id)}">${esc(s.short)}</a>`)
    );
    boards.innerHTML = "[" + links.join(" / ") + "]";
  }

  // ----- Story table (home, source and community listings) -----
  function storyRow(it, i) {
    const m = it.meta ?? {};
    const hot = (it.score ?? 0) >= 100 || (m.replies ?? 0) >= 100;
    const fresh = Date.now() / 1000 - it.time < 3600;
    const badge = hot ? "[HOT!]" : fresh ? "[NEW!]" : "";
    const domain = m.externalUrl ? host(m.externalUrl) : host(it.url);
    const who = it.author ? `by ${esc(it.author)}` : "";
    const points = it.score != null ? `${esc(it.score)} points ` : "";
    const threadHref = `#/${enc(it.source)}/${enc(it.community)}/${enc(it.threadId)}`;
    return `
      <div class="trow">
        <div class="c-title">
          <div><span class="rank">${i + 1}.</span> <span aria-hidden="true">&#9650;</span> <a class="story-title" href="${threadHref}">${esc(it.title || snippet(it.text) || "(no title)")}</a> <span class="badge-tag">${badge}</span></div>
          <div class="story-meta">(${esc(domain)}) ${points}${who}, ${esc(ago(it.time))} | <a href="${threadHref}">read thread</a> | <a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">original ↗</a></div>
        </div>
        <div class="c-forums">${tag(it.source)} ${esc(srcName(it.source))}</div>
        <div class="c-replies">${m.replies != null ? esc(m.replies) : "–"}</div>
        <div class="c-views">–</div>
        <div class="c-last">${esc(ago(it.time))}<br>by <b>${esc(it.author || "Anonymous")}</b></div>
      </div>`;
  }

  const snippet = (t, n = 110) => {
    const s = (t || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) + "…" : s;
  };

  function tableHTML(items) {
    if (!items.length) return `<p class="empty">Nothing to show here.</p>`;
    return `
      <div class="table">
        <div class="trow thead" aria-hidden="true">
          <div>Story</div><div>Forums</div><div class="c-replies">Replies</div><div class="c-views">Views</div><div>Last post</div>
        </div>
        ${items.map(storyRow).join("")}
      </div>`;
  }

  function applyFilter() {
    const q = filterInput.value.trim().toLowerCase();
    const shown = q
      ? state.items.filter(it => `${it.title} ${it.text} ${it.author} ${it.url}`.toLowerCase().includes(q))
      : state.items;
    const holder = $("#table-holder");
    if (holder) holder.innerHTML = tableHTML(shown);
    const count = $("#count");
    if (count) count.textContent = q ? `${shown.length} of ${state.items.length} shown` : "";
  }

  // ----- Pages -----
  async function showHome(token, sourceFilter) {
    const data = await api("/latest");
    if (token !== state.token) return;
    const items = sourceFilter ? data.items.filter(it => it.source === sourceFilter) : data.items;
    state.items = items;
    state.mode = "list";
    document.title = sourceFilter ? `${srcName(sourceFilter)} · Nice Chan` : "Nice Chan";
    const notice = data.errors.length
      ? `<p class="note">Some sources did not respond: ${data.errors.map(e => esc(`${srcShort(e.source)} ${e.community}`)).join(", ")}.</p>`
      : "";
    const banner = sourceFilter ? "" : `
      <div class="banner">
        <div class="mascot" role="img" aria-label="Nice Chan mascot, a smiling round face"><pre>${esc(MASCOT)}</pre></div>
        <h1>/news/ - The World, All at Once</h1>
        <div class="rule" aria-hidden="true"></div>
      </div>
      <div class="greentext-intro">
        <div>&gt;be you</div>
        <div>&gt;want to know what the internet is actually saying</div>
        <div>&gt;read every forum at once, minus the slurs</div>
      </div>`;
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
    state.mode = "thread";
    const op = posts[0];
    const m = op.meta ?? {};
    const title = op.title || snippet(op.text, 90) || `Thread ${id}`;
    const domain = m.externalUrl ? host(m.externalUrl) : host(op.url);
    const replies = Math.max(posts.length - 1, 0);
    document.title = `${title} · ${srcShort(source)} · Nice Chan`;

    // Depth from parent links. A reply to the thread root is flat (depth 0), which suits 4chan's flat threads.
    const depth = new Map([[op.postId, -1]]);
    const rows = posts.slice(1).map(p => {
      const parent = p.parentId ?? op.postId;
      const d = parent === op.postId ? 0 : Math.min((depth.get(parent) ?? 0) + 1, 3);
      depth.set(p.postId, d);
      return { p, d };
    });

    const remoteNote = m.externalUrl
      ? ` | <a href="${esc(m.externalUrl)}" target="_blank" rel="noopener noreferrer">article on ${esc(host(m.externalUrl))} ↗</a>`
      : "";
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
            </header>
            ${img}${full}
            <div class="post-body">${bodyHTML(p.text) || ""}</div>
          </article>
        </div>`;
    };

    view.innerHTML = `
      <div class="thread-head">
        <div><a href="#/${enc(source)}/${enc(community)}">[back to ${esc(commTitle(source, community))}]</a></div>
        <div class="title">${inline(title)} <span class="domain">(${esc(domain)})</span></div>
        <div class="info">${tag(source)} ${esc(srcName(source))} | ${plural(replies, "comment", "comments")} | ${esc(ago(op.time))} | <a href="${esc(op.url)}" target="_blank" rel="noopener noreferrer">View original ↗</a>${remoteNote}</div>
      </div>
      <h2 class="comments-h">&gt;comments</h2>
      <p class="note">Every comment links to its original. Words hidden by Safe mode show as a button; press it to turn Safe mode off.</p>
      <div class="eq" aria-hidden="true">${"=".repeat(160)}</div>
      ${postBox(op, 0, true)}
      ${rows.map(({ p, d }) => postBox(p, d, false)).join("")}
      <p class="attrib-note">Comments are by their original authors on ${esc(srcName(source))}. Nice Chan does not own them. Excerpts only; follow the links to read the rest.</p>`;
    window.scrollTo({ top: 0 });
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
        <p>Nice Chan reads public discussions from several forums side by side, so you can see how different communities talk about the same thing.</p>
        <p>Every thread and comment shows where it came from and links to the original. Nice Chan does not own the text it shows. Only excerpts are displayed.</p>
        <p>Safe mode is on by default. Rude words are hidden and images are blurred until you click them. Press a hidden word to turn Safe mode off.</p>
        <p>Summaries and other AI-generated text, when they exist, are labelled as AI and kept separate from what people wrote.</p>
      </div>`;
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


  // ----- Digest: stories that span two or more sources -----
  async function showDigestList(token) {
    const d = await api("/digest");
    if (token !== state.token) return;
    state.mode = "page";
    document.title = "Digest · Nice Chan";
    const job = d.job?.last?.at ? `Last update ${ago(d.job.last.at)}.` : "First update is running.";
    const notice = d.aiEnabled
      ? `<p class="note">AI-generated summaries are labelled as such. Check the sources. ${job}</p>`
      : `<p class="note">[AI rundowns are off] Set ANTHROPIC_API_KEY to add per-community framing. Stories below show each community’s threads with links. ${job}</p>`;
    const rows = d.items.map(st => `
      <div class="trow${st.rare ? " rare-row" : ""}">
        <div class="c-title">
          <div>${st.rare ? `<span class="rare">[RARE: ${esc(st.rare)}]</span> ` : ""}<a class="story-title" href="#/digest/${enc(st.id)}">${esc(st.label)}</a></div>
          <div class="story-meta">${st.status === "ready" ? "[AI rundown]" : "[threads only]"} | ${st.sources.map(s => esc(srcShort(s))).join(", ")}</div>
        </div>
        <div class="c-forums">${st.sources.map(s => `<span class="sq" style="color:${srcColor(s)}">&#9632;</span> ${esc(srcName(s))}`).join("<br>")}</div>
        <div class="c-replies">${esc(st.itemCount)}</div>
        <div class="c-views">–</div>
        <div class="c-last">${esc(ago(st.lastTime))}</div>
      </div>`).join("");
    view.innerHTML = `
      <h2 class="page-title">&gt;digest</h2>
      ${notice}
      <div class="table">
        <div class="trow thead" aria-hidden="true"><div>Story</div><div>Forums</div><div class="c-replies">Threads</div><div class="c-views">Views</div><div>Last update</div></div>
        ${rows || `<p class="empty">No shared stories yet. They appear after the first ingest finds the same event on two or more sources.</p>`}
      </div>`;
  }

  async function showDigestStory(id, token) {
    const d = await api(`/digest/${enc(id)}`);
    if (token !== state.token) return;
    state.mode = "page";
    const p = d.payload;
    const ready = d.status === "ready";
    document.title = `${d.label} · Digest · Nice Chan`;
    const rare = d.rare ? `<span class="rare">[RARE: ${esc(d.rare)}]</span>` : "";
    const aiBox = ready
      ? `<section class="ai"><p class="ai-tag">[AI summary] Written by ${esc(p.model)} on ${esc(stamp(p.generatedAt))}. Check the sources.</p><p>${esc(p.summary)}</p></section>`
      : `<section class="ai"><p class="ai-tag">[AI framing not available]</p><p>${esc(p.reason || "No framing yet.")}</p></section>`;

    const communities = ready
      ? p.communities.map(c => ({ key: c.key, claims: c.claims, tone: c.tone, blame: c.blame, quotes: c.quotes }))
      : [];
    const rawByKey = new Map((p.raw || []).map(g => [g.key, g]));
    const columns = (p.raw || []).map(g => {
      const framed = communities.find(c => c.key === g.key);
      const [src, ...rest] = g.key.split("/");
      return `
        <div class="post column">
          <header class="post-head"><span class="name">${esc(commTitleFrom(src, rest.join("/")))}</span> <span>${tag(src)}</span> <span>${esc(g.count)} threads</span></header>
          ${framed ? `
            <p><b>Claims:</b></p><ul>${framed.claims.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
            <p><b>Tone:</b> ${esc(framed.tone)}</p>
            <p><b>Blame or credit:</b> ${esc(framed.blame)}</p>
            <p><b>In their words:</b></p>
            ${framed.quotes.map(q => `<blockquote>&ldquo;${esc(q.quote)}&rdquo; ${q.url ? `<a href="${esc(q.url)}" target="_blank" rel="noopener noreferrer">[source post ↗]</a>` : ""}</blockquote>`).join("")}
          ` : `<p class="muted-line">Threads only: AI framing is not available for this community yet.</p>`}
          <p><b>Threads:</b></p>
          <ul>${g.threads.map(t => `<li><a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.title || t.excerpt || "(no title)")}</a> <span class="muted-line">by ${esc(t.author)}, ${esc(ago(t.time))}</span></li>`).join("")}</ul>
        </div>`;
    }).join("");

    const agree = ready ? `
      <section class="ai">
        <p class="ai-tag">[AI] Common ground</p>
        <p>${esc(p.commonGround)}</p>
        ${p.minorityCarried ? `<p class="minority">${esc(p.minorityNote)}</p>` : ""}
      </section>
      <section class="ai">
        <p class="ai-tag">[AI] Where they split</p>
        <ol>${(p.disagreements || []).map(x => `<li><b>${esc(x.topic)}</b><ul>${Object.entries(x.sides || {}).map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join("")}</ul></li>`).join("")}</ol>
      </section>` : "";

    view.innerHTML = `
      <div class="thread-head">
        <div><a href="#/digest">[back to digest]</a></div>
        <div class="title">${esc(d.label)} ${rare}</div>
        <div class="info">${d.sources.map(s => tag(s)).join(" ")} | ${esc(d.itemCount)} threads | last update ${esc(ago(d.lastTime))}</div>
      </div>
      ${aiBox}
      ${agree}
      <h2 class="comments-h">&gt;each community</h2>
      <p class="note">Each column is one community. Quotes are excerpts copied from its posts, with a link to the post.</p>
      <div class="columns">${columns}</div>`;
    window.scrollTo({ top: 0 });
  }

  // Board or community label for digest columns.
  function commTitleFrom(src, comm) {
    const t = commTitle(src, comm);
    return src === "4chan" ? `/${comm}/ ${t}` : t;
  }

  async function route() {
    const token = ++state.token;
    const parts = parse();
    const [source, community, id] = parts;
    searchBox.hidden = !(searchBtn.getAttribute("aria-expanded") === "true");
    if (!parts.length) state.mode = "home";
    view.innerHTML = '<p class="loading">Loading…</p>';
    try {
      if (!source) await showHome(token);
      else if (source === "digest") {
        if (community) await showDigestStory(community, token);
        else await showDigestList(token);
      }
      else if (source === "s" && community) await showHome(token, community);
      else if (source === "sources" && !community) showSources();
      else if (source === "about" && !community) showAbout();
      else if (!srcMeta(source) || !community) throw new Error("This page does not exist.");
      else if (!id) await showListing(source, community, token);
      else await showThread(source, community, id, token);
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

  // Pressing a masked word turns Safe mode off and reloads the page to show it.
  document.addEventListener("click", e => {
    const reveal = e.target.closest("[data-reveal]");
    if (reveal) {
      setSafe(false);
      route();
      return;
    }
    const thumb = e.target.closest(".thumb.blurred");
    if (thumb) { thumb.classList.remove("blurred"); return; }
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
