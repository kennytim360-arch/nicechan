// Polite HTTP client shared by every source adapter.
// - One request slot per host, spaced by a minimum gap (4chan asks for 1 req/s).
// - Short in-memory cache per URL, with conditional requests (If-Modified-Since / ETag).
// - One retry after 429/503, and a 10s timeout.
// Adapters call getJSON/postJSON. Tests and fixture recording swap the transport with setImpl().

const USER_AGENT = "NiceChan/0.3 (read-only aggregator; local install)";
const MIN_GAP_MS = { "a.4cdn.org": 1000, "boards.4chan.org": 1000, "hacker-news.firebaseio.com": 100, "hn.algolia.com": 300 };
const DEFAULT_GAP_MS = 300;
const MAX_CACHE_ENTRIES = 500;

const nextSlot = new Map(); // host -> earliest time the next request may start
const cache = new Map();    // key -> { t, ttl, data, etag, lastModified }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function throttle(host) {
  const gap = MIN_GAP_MS[host] ?? DEFAULT_GAP_MS;
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(host) ?? 0);
  nextSlot.set(host, slot + gap); // reserve synchronously so concurrent callers queue in order
  if (slot > now) await sleep(slot - now);
}

function remember(key, entry) {
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

async function realRequest({ method = "GET", url, body, ttl = 60_000 }) {
  const key = requestKey({ method, url, body });
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < hit.ttl) return hit.data;

  const host = new URL(url).host;
  const send = async () => {
    const headers = { "User-Agent": USER_AGENT, Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (hit?.lastModified) headers["If-Modified-Since"] = hit.lastModified;
    if (hit?.etag) headers["If-None-Match"] = hit.etag;
    return fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  };

  await throttle(host);
  let res = await send();
  if (res.status === 429 || res.status === 503) {
    await sleep(3000);
    await throttle(host);
    res = await send();
  }
  if (res.status === 304 && hit) {
    hit.t = Date.now();
    return hit.data;
  }
  if (!res.ok) throw Object.assign(new Error(`${host} returned ${res.status}`), { status: res.status });

  const data = await res.json();
  remember(key, {
    t: Date.now(),
    ttl,
    data,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  });
  return data;
}

// Cache key for a request. Fixtures use the same key, so recorded responses can be replayed.
function requestKey({ method = "GET", url, body }) {
  return `${method} ${url} ${body ? JSON.stringify(body) : ""}`;
}

let impl = realRequest;

module.exports = {
  getJSON: (url, opts = {}) => impl({ method: "GET", url, ...opts }),
  postJSON: (url, body, opts = {}) => impl({ method: "POST", url, body, ...opts }),
  // Swap the transport (used by tests and the fixture recorder). Pass nothing to restore.
  setImpl: fn => { impl = fn || realRequest; },
  realRequest,
  requestKey,
  sleep,
};
