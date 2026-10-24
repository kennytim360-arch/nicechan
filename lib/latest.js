// "Latest" across all enabled sources. Results are cached briefly, so repeated page loads do not re-hit the APIs.
const { mergeLatest } = require("./normalize");

function createLatest(registry, { perCommunity = 12, maxTotal = 120, cacheSeconds = 120 } = {}) {
  let cached = null;
  let inflight = null;

  async function build() {
    const targets = await registry.latestTargets();
    const results = await Promise.allSettled(
      targets.map(t => registry.get(t.source).fetchRecent(t.community, perCommunity))
    );
    const items = [];
    const errors = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") items.push(...r.value);
      else errors.push({ source: targets[i].source, community: targets[i].community, message: r.reason?.message ?? "failed" });
    });
    return { items: mergeLatest(items).slice(0, maxTotal), errors };
  }

  return async function latest() {
    if (cached && Date.now() - cached.t < cacheSeconds * 1000) return cached.data;
    if (!inflight) {
      inflight = build()
        .then(data => {
          cached = { t: Date.now(), data };
          return data;
        })
        .finally(() => { inflight = null; });
    }
    return inflight;
  };
}

module.exports = { createLatest };
