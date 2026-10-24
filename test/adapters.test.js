// Adapter tests. Each adapter runs against responses recorded in test/fixtures (no network).
// To refresh the fixtures: npm run record
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const http = require("../lib/http");
const config = require("../config.json");
const { makers } = require("../lib/sources");
const { mergeLatest } = require("../lib/normalize");

const SOURCES = ["hn", "4chan", "lemmy", "manifold", "lesswrong", "eaforum"];

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8"));
}

// Serve responses from the recording. A URL that was not recorded fails the test loudly.
function replay(records) {
  http.setImpl(async opts => {
    const key = http.requestKey(opts);
    if (!(key in records)) throw new Error(`no recorded response for ${key}`);
    return records[key];
  });
}

after(() => http.setImpl(null));

const ITEM_KEYS = ["source", "community", "threadId", "postId", "parentId", "author", "time", "title", "text", "url", "score", "thumb", "meta"];

function assertShape(it) {
  assert.deepEqual(Object.keys(it).sort(), [...ITEM_KEYS].sort(), "item has exactly the shared keys");
  assert.equal(typeof it.source, "string");
  assert.equal(typeof it.community, "string");
  assert.equal(typeof it.threadId, "string");
  assert.equal(typeof it.postId, "string");
  assert.ok(it.parentId === null || typeof it.parentId === "string");
  assert.equal(typeof it.author, "string");
  assert.ok(Number.isInteger(it.time) && it.time >= 0, `time is unix seconds: ${it.time}`);
  assert.equal(typeof it.title, "string");
  assert.equal(typeof it.text, "string");
  assert.match(it.url, /^https:\/\//, "every item links to its original");
  assert.ok(it.score === null || typeof it.score === "number");
  assert.ok(it.thumb === null || typeof it.thumb === "string");
  assert.equal(typeof it.meta, "object");
}

for (const name of SOURCES) {
  test(`${name}: listings and threads normalise to the shared shape`, async () => {
    const fx = load(name);
    replay(fx.records);
    const adapter = makers[name](config.sources[name]);
    const { community, threadId } = fx.scenario;

    const communities = await adapter.listCommunities();
    assert.ok(communities.length > 0, "lists at least one community");
    for (const c of communities) {
      assert.equal(c.source, name);
      assert.equal(typeof c.community, "string");
      assert.equal(typeof c.title, "string");
    }

    const listing = await adapter.fetchRecent(community, fx.scenario.listLimit);
    assert.ok(listing.length > 0, "listing has items");
    listing.forEach(assertShape);
    for (const it of listing) {
      assert.equal(it.source, name);
      assert.equal(it.community, community);
      assert.equal(it.threadId, it.postId, "listing items are thread roots");
    }

    const thread = await adapter.fetchThread(community, threadId);
    assert.equal(thread.length, fx.scenario.threadCount);
    thread.forEach(assertShape);
    const root = thread[0];
    assert.equal(root.threadId, threadId);
    assert.equal(root.postId, threadId, "first item is the thread root");
    assert.equal(root.parentId, null);
    for (const it of thread) assert.equal(it.threadId, threadId);
    for (const it of thread.slice(1)) assert.notEqual(it.parentId, null, "replies name a parent");

    // Ids are unique within a thread.
    assert.equal(new Set(thread.map(i => i.postId)).size, thread.length);
  });
}

test("hn: search returns story items with attribution links", async () => {
  const fx = load("hn");
  replay(fx.records);
  const hn = makers.hn(config.sources.hn);
  const hits = await hn.search(fx.scenario.search.query, 5);
  assert.equal(hits.length, fx.scenario.search.count);
  hits.forEach(assertShape);
});

test("adapters refuse communities that are not configured", async () => {
  replay({});
  const hn = makers.hn(config.sources.hn);
  await assert.rejects(() => hn.fetchRecent("best", 5), /unknown community/);
  const lemmy = makers.lemmy(config.sources.lemmy);
  await assert.rejects(() => lemmy.fetchRecent("evil.example/technology", 5), /not configured/);
  replay(load("4chan").records);
  const chan = makers["4chan"]({ boards: ["g"] });
  await assert.rejects(() => chan.fetchRecent("b", 5), /not enabled/);
});

test("mergeLatest sorts newest first and drops duplicates", () => {
  const mk = (source, postId, time) => ({ source, postId, time });
  const merged = mergeLatest([mk("hn", "1", 10), mk("hn", "1", 10), mk("lemmy", "2", 30), mk("hn", "3", 20)]);
  assert.deepEqual(merged.map(m => m.postId), ["2", "3", "1"]);
});

test("http cache key distinguishes method and body", () => {
  assert.notEqual(http.requestKey({ url: "https://x/a" }), http.requestKey({ method: "POST", url: "https://x/a", body: {} }));
  assert.notEqual(http.requestKey({ method: "POST", url: "https://x/a", body: { q: 1 } }), http.requestKey({ method: "POST", url: "https://x/a", body: { q: 2 } }));
});
