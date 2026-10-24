// Text helpers: turn HTML and light Markdown from the APIs into plain text.
// Output is plain text. The browser escapes it, so no HTML reaches the page.

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function htmlToText(html) {
  if (html == null) return "";
  const s = String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(s).replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").trim();
}

function stripMarkdown(md) {
  if (!md) return "";
  return String(md)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|~~)/g, "")
    .replace(/\r/g, "")
    .trim();
}

// Unix seconds from an ISO timestamp (Lemmy and forum APIs). 0 if unparseable.
function isoToUnix(s) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

// Third-party text is shown as an excerpt, never a full copy. Cuts never split a masked-word marker (see lib/filter.js).
const EXCERPT_CHARS = 1200;
function excerpt(text, max = EXCERPT_CHARS) {
  if (!text || text.length <= max) return text || "";
  let cut = max;
  const open = text.lastIndexOf("", cut);
  const close = text.lastIndexOf("", cut);
  if (open > close) cut = open; // do not leave a half-open marker behind
  return text.slice(0, cut).trimEnd() + "…";
}

module.exports = { decodeEntities, htmlToText, stripMarkdown, isoToUnix, excerpt, EXCERPT_CHARS };
