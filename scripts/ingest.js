// One-off ingest and digest refresh, without starting the server.
// Run: npm run ingest   (add ANTHROPIC_API_KEY to .env to frame stories with the model)
const config = require("../config.json");
const { createRegistry } = require("../lib/sources");
const { openStore } = require("../lib/digest/store");
const { ingestAll } = require("../lib/digest/service");
const { refresh } = require("../lib/digest/pipeline");
const path = require("path");

(async () => {
  const registry = createRegistry(config);
  const store = openStore(path.join(__dirname, "..", "data", "nicechan.db"));
  const ingest = await ingestAll(registry, store);
  console.log(`ingested ${ingest.items} threads from ${ingest.targets} communities; ${ingest.failed.length} failed`);
  for (const f of ingest.failed) console.log(`  failed: ${f}`);
  const report = await refresh({ store, env: process.env });
  console.log("stories:", report);
  store.close();
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
