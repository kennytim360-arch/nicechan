// Background job: ingest every community into SQLite, then refresh stories.
// Runs once shortly after start and then every `intervalMinutes`. One run at a time.
const { openStore } = require("./store");
const { refresh, WINDOW_HOURS } = require("./pipeline");
const { IMAGE_GEN } = require("../sources/4chan");

async function ingestAll(registry, store, { perTarget = 40, now = Math.floor(Date.now() / 1000) } = {}) {
  const targets = await registry.allTargets();
  let items = 0;
  const failed = [];
  for (const t of targets) {
    try {
      const got = await registry.get(t.source).fetchRecent(t.community, perTarget, { includeSticky: true });
      items += store.upsertItems(got, now);
    } catch (err) {
      failed.push(`${t.source}/${t.community}: ${err.message}`);
    }
  }
  store.purgeThreadsByTitle("4chan", IMAGE_GEN);
  store.pruneItems(now - 7 * 24 * 3600);
  return { targets: targets.length, items, failed };
}

function startDigest({ registry, file, intervalMinutes = 15, env = process.env, log = console.log }) {
  const store = openStore(file);
  let running = false;
  let last = null;

  async function run() {
    if (running) return last;
    running = true;
    const started = Math.floor(Date.now() / 1000);
    try {
      const ingest = await ingestAll(registry, store, { now: started });
      const report = await refresh({ store, env, now: Math.floor(Date.now() / 1000), fetchThreadPosts: (src, comm, id) => registry.get(src).fetchThread(comm, id) });
      last = { at: started, ingest: { targets: ingest.targets, items: ingest.items, failed: ingest.failed.length }, report };
      log(`digest: ${ingest.targets} communities, ${ingest.items} threads stored, ${ingest.failed.length} failed; stories ${JSON.stringify(report)}`);
    } catch (err) {
      last = { at: started, error: err.message };
      log(`digest run failed: ${err.message}`);
    } finally {
      running = false;
    }
    return last;
  }

  const first = setTimeout(run, 5_000);
  const timer = setInterval(run, intervalMinutes * 60_000);
  first.unref();
  timer.unref();

  return { store, run, status: () => ({ running, last, windowHours: WINDOW_HOURS }), stop: () => { clearTimeout(first); clearInterval(timer); store.close(); } };
}

module.exports = { startDigest, ingestAll };
