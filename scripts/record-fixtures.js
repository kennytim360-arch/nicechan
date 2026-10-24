// Records live API responses into test/fixtures/<source>.json so the tests can replay them offline.
// Run: npm run record   (needs internet access; slow because of rate limits)
// Re-run only when an API changes shape, then review the diff before committing.
const fs = require("fs");
const path = require("path");
const http = require("../lib/http");
const config = require("../config.json");
const { makers } = require("../lib/sources");

const OUT = path.join(__dirname, "..", "test", "fixtures");
fs.mkdirSync(OUT, { recursive: true });

// Each scenario picks a small, real example: a listing and one thread with replies.
const SCENARIOS = {
  hn: { community: "top", listLimit: 5, search: "rust" },
  "4chan": { community: "g", listLimit: 5 },
  lemmy: { community: "programming.dev/technology", listLimit: 5 },
  manifold: { community: "markets", listLimit: 5 },
  lesswrong: { community: "top", listLimit: 5 },
  eaforum: { community: "top", listLimit: 5 },
};

async function recordSource(name, scenario) {
  const records = {};
  http.setImpl(async opts => {
    const data = await http.realRequest({ ...opts, ttl: 0 });
    records[http.requestKey(opts)] = data;
    return data;
  });

  const adapter = makers[name](config.sources[name]);
  await adapter.listCommunities();
  const list = await adapter.fetchRecent(scenario.community, scenario.listLimit);
  if (!list.length) throw new Error(`${name}: empty listing`);
  // Pick the item with the most replies so the thread fixture contains real comments.
  const pick = [...list].sort((a, b) => (b.meta.replies ?? 0) - (a.meta.replies ?? 0))[0];
  const thread = await adapter.fetchThread(scenario.community, pick.threadId);
  const scenarioOut = { community: scenario.community, listLimit: scenario.listLimit, threadId: pick.threadId, listingCount: list.length, threadCount: thread.length };

  if (scenario.search && adapter.search) {
    const hits = await adapter.search(scenario.search, 5);
    scenarioOut.search = { query: scenario.search, count: hits.length };
  }

  http.setImpl(null);
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ scenario: scenarioOut, records }, null, 1) + "\n");
  console.log(`${name}: listing ${list.length}, thread ${thread.length} items, ${Object.keys(records).length} responses`);
}

(async () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    try {
      await recordSource(name, scenario);
    } catch (err) {
      console.error(`${name}: FAILED: ${err.message}`);
      process.exitCode = 1;
    } finally {
      http.setImpl(null);
    }
  }
})();
