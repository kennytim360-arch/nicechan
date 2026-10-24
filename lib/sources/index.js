// Builds the enabled source adapters from config.json.
// Every adapter returns items in the shape described in lib/normalize.js.
const makers = {
  hn: cfg => require("./hn").create(cfg),
  "4chan": cfg => require("./4chan").create(cfg),
  lemmy: cfg => require("./lemmy").create(cfg),
  manifold: cfg => require("./manifold").create(cfg),
  lesswrong: cfg => require("./forum-graphql").createForum("lesswrong", cfg),
  eaforum: cfg => require("./forum-graphql").createForum("eaforum", cfg),
};

function createRegistry(config) {
  const sources = new Map();
  const communityCache = new Map(); // source id -> Promise<community list>

  for (const [id, scfg] of Object.entries(config.sources ?? {})) {
    if (scfg.enabled === false) continue;
    if (!makers[id]) throw new Error(`config: unknown source "${id}"`);
    sources.set(id, { id, cfg: scfg, adapter: makers[id](scfg) });
  }

  function get(id) {
    return sources.get(id)?.adapter ?? null;
  }

  function communities(id) {
    if (!communityCache.has(id)) {
      const p = sources.get(id).adapter.listCommunities().catch(err => {
        communityCache.delete(id); // retry on the next request
        throw err;
      });
      communityCache.set(id, p);
    }
    return communityCache.get(id);
  }

  // Source metadata plus communities, for the sidebar. A source that fails is listed with an error.
  async function describe() {
    return Promise.all(
      [...sources.values()].map(async s => {
        const meta = s.adapter.meta;
        try {
          return { ...meta, communities: await communities(s.id) };
        } catch (err) {
          return { ...meta, communities: [], error: err.message };
        }
      })
    );
  }

  async function hasCommunity(id, community) {
    if (!sources.has(id)) return false;
    try {
      return (await communities(id)).some(c => c.community === community);
    } catch {
      return false;
    }
  }

  // Communities that feed the "Latest" page: config `latest` list if given, otherwise all (4chan: none by default).
  async function latestTargets() {
    const out = [];
    for (const s of sources.values()) {
      const list = await communities(s.id).catch(() => []);
      const wanted = s.cfg.latest ?? (s.id === "4chan" ? [] : list.map(c => c.community));
      for (const c of wanted) out.push({ source: s.id, community: c });
    }
    return out;
  }

  return { get, describe, hasCommunity, latestTargets, ids: () => [...sources.keys()] };
}

module.exports = { createRegistry, makers };
