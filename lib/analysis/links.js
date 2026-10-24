// Shared links. Many forums link the same article; threads that share one normalised URL are about the same story.
const TRACKING = /^(utm_|fbclid|gclid|ref|source|mc_cid|mc_eid)/i;

function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.toLowerCase().replace(/^(www|m|amp)\./, "");
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const qs = params.length ? "?" + new URLSearchParams(params).toString() : "";
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}${qs}`;
  } catch {
    return null;
  }
}

// Every link a thread points at: its external link, and links written in its text.
function linksOf(item) {
  const out = new Set();
  const ext = normalizeUrl(item.meta?.externalUrl || "");
  if (ext) out.add(ext);
  for (const m of String(item.text || "").matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    const n = normalizeUrl(m[0].replace(/[.,;:!?]+$/, ""));
    if (n) out.add(n);
  }
  return [...out];
}

module.exports = { normalizeUrl, linksOf };
