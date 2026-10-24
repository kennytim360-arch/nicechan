// Digest tests. The model is mocked: no network, no API key.
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { cluster } = require("../lib/digest/cluster");
const { groupByCommunity, verifyFrame, frameCluster, chooseCommonGround, verifyConsensus } = require("../lib/digest/frame");
const { openStore } = require("../lib/digest/store");
const { refresh, rareFlag } = require("../lib/digest/pipeline");
const llm = require("../lib/digest/llm");

afterEach(() => llm.setTransport(null));

const it = (source, community, postId, title, text = "", time = 1_700_000_000, replies = 0) => ({
  source, community, threadId: postId, postId, parentId: null, author: "a", time, title, text,
  url: `https://example.test/${source}/${community}/${postId}`, score: null, thumb: null, meta: { replies },
});

test("clusters the same event across sources and keeps unrelated threads apart", () => {
  const items = [
    it("hn", "top", "1", "Dagger 1.0 beta released for CI pipelines"),
    it("4chan", "g", "2", "Dagger 1.0 beta released, CI pipelines get faster"),
    it("lemmy", "technology", "3", "Dagger 1.0 beta released with new CI pipelines"),
    it("hn", "new", "4", "Rent control vote passes in a mid-sized city"),
    it("lemmy", "news", "5", "City council passes rent control vote in mid-sized city"),
    it("manifold", "markets", "6", "Will it rain in Paris next Tuesday?"),
  ];
  const groups = cluster(items);
  const dagger = groups.find(g => g.items.some(x => x.postId === "1"));
  assert.ok(dagger.items.some(x => x.postId === "2"), "4chan thread joins the dagger story");
  assert.ok(dagger.items.some(x => x.postId === "3"), "lemmy thread joins the dagger story");
  assert.ok(!dagger.items.some(x => x.postId === "4"), "rent control stays separate");
  const rent = groups.find(g => g.items.some(x => x.postId === "4"));
  assert.ok(rent.items.some(x => x.postId === "5"));
  assert.equal(groups.find(g => g.items.some(x => x.postId === "6")).items.length, 1);
});

test("a single-source group is not a shared story", () => {
  const groups = cluster([it("hn", "top", "1", "Dagger 1.0 beta"), it("hn", "new", "2", "Dagger 1.0 beta out")]);
  const shared = groups.filter(g => g.sources.length >= 2);
  assert.equal(shared.length, 0);
});

test("verifyFrame accepts verbatim quotes and rejects invented ones", () => {
  const items = [
    it("hn", "top", "10", "Dagger 1.0", "This build is fast and the cache works well in practice."),
    it("4chan", "g", "20", "dagger", "Another anon says it is overhyped and the config is bad."),
  ];
  const groups = groupByCommunity(items);
  const good = {
    summary: "Dagger 1.0 beta was released.",
    communities: [
      { community: "hn/top", claims: ["fast"], tone: "positive", blame: "none", quotes: [{ postId: "10", quote: "the cache works well" }, { postId: "10", quote: "This build is fast" }] },
      { community: "4chan/g", claims: ["overhyped"], tone: "sceptical", blame: "the config", quotes: [{ postId: "20", quote: "it is overhyped" }, { postId: "20", quote: "the config is bad" }] },
    ],
  };
  assert.deepEqual(verifyFrame(good, groups).errors, []);

  const invented = JSON.parse(JSON.stringify(good));
  invented.communities[0].quotes[0].quote = "this was the best release ever";
  const v = verifyFrame(invented, groups);
  assert.equal(v.ok, false);
  assert.match(v.errors.join(" "), /not found verbatim/);

  const wrongPost = JSON.parse(JSON.stringify(good));
  wrongPost.communities[1].quotes[0].postId = "10";
  assert.equal(verifyFrame(wrongPost, groups).ok, false);
});

test("frameCluster retries when a quote is not verbatim, then succeeds", async () => {
  const items = [it("hn", "top", "10", "Dagger 1.0", "The cache works well in practice."), it("4chan", "g", "20", "dagger", "It is overhyped and the config is bad.")];
  const groups = groupByCommunity(items);
  const bad = { summary: "s", communities: [
    { community: "hn/top", claims: ["c"], tone: "t", blame: "none", quotes: [{ postId: "10", quote: "made up words here" }, { postId: "10", quote: "cache works well" }] },
    { community: "4chan/g", claims: ["c"], tone: "t", blame: "none", quotes: [{ postId: "20", quote: "overhyped and the config" }, { postId: "20", quote: "config is bad" }] },
  ] };
  const good = JSON.parse(JSON.stringify(bad));
  good.communities[0].quotes[0].quote = "cache works well";
  let calls = 0;
  llm.setTransport(async () => JSON.stringify(++calls === 1 ? bad : good));
  const out = await frameCluster("Dagger", groups);
  assert.equal(calls, 2);
  assert.equal(out.communities[0].quotes[0].quote, "cache works well");
});

test("masked words are never sent to the model", async () => {
  const items = [it("hn", "top", "10", "Dagger 1.0", "This is shit and the cache is fine."), it("4chan", "g", "20", "dagger", "The config is ok.")];
  const groups = groupByCommunity(items);
  let sent = "";
  llm.setTransport(async ({ user }) => { sent += user; return "{}"; });
  await frameCluster("Dagger", groups, { maxAttempts: 1 }).catch(() => {});
  assert.ok(!sent.includes("shit"), "rude word not sent");
  assert.ok(sent.includes("s***"), "masked form sent instead");
});

test("common ground picks the best worst-case candidate", () => {
  const counts = { "hn/top": 10, "4chan/g": 10, "lemmy/technology": 10 };
  const scores = [
    { "hn/top": 5, "4chan/g": 1, "lemmy/technology": 5 },
    { "hn/top": 4, "4chan/g": 3, "lemmy/technology": 4 },
    { "hn/top": 2, "4chan/g": 5, "lemmy/technology": 2 },
  ];
  const pick = chooseCommonGround(["a", "b", "c"], scores, counts);
  assert.equal(pick.text, "b");
  assert.equal(pick.worstCase, 3);
  assert.equal(pick.minorityCarried, false);
});

test("flags when a minority community decides the common ground", () => {
  // 4chan is the minority (2 of 22 threads). Only its low score keeps "a" from winning.
  const counts = { "hn/top": 10, "lemmy/technology": 10, "4chan/g": 2 };
  const scores = [
    { "hn/top": 5, "lemmy/technology": 5, "4chan/g": 1 },
    { "hn/top": 4, "lemmy/technology": 4, "4chan/g": 4 },
    { "hn/top": 3, "lemmy/technology": 3, "4chan/g": 3 },
  ];
  const pick = chooseCommonGround(["a", "b", "c"], scores, counts);
  assert.equal(pick.text, "b");
  assert.equal(pick.minorityCarried, true, "without 4chan the answer would be a, so minority carried it");
  assert.match(pick.minorityNote, /minority/);
});

test("verifyConsensus enforces 3 candidates, scores 1-5 and 3 disagreements", () => {
  const framed = [{ key: "hn/top" }, { key: "4chan/g" }];
  const ok = {
    candidates: ["x", "y", "z"],
    scores: [0, 1, 2].map(() => ({ scores: { "hn/top": 3, "4chan/g": 4 } })),
    disagreements: [{ topic: "t", sides: {} }, { topic: "t", sides: {} }, { topic: "t", sides: {} }],
  };
  assert.equal(verifyConsensus(ok, framed).ok, true);
  assert.equal(verifyConsensus({ ...ok, candidates: ["x"] }, framed).ok, false);
  assert.equal(verifyConsensus({ ...ok, scores: [{ scores: { "hn/top": 9, "4chan/g": 1 } }, ...ok.scores.slice(1)] }, framed).ok, false);
});

test("the /x/ rare flag needs /x/ and at least one other source", () => {
  const x = it("4chan", "x", "1", "Strange signal reported again");
  const hn = it("hn", "top", "2", "Strange signal reported again");
  assert.equal(rareFlag({ items: [x, hn], sources: ["4chan", "hn"] }), "rare combo");
  assert.equal(rareFlag({ items: [x], sources: ["4chan"] }), null);
  assert.equal(rareFlag({ items: [it("4chan", "g", "3", "t"), hn], sources: ["4chan", "hn"] }), null);
});

test("store round-trips items and digests", () => {
  const store = openStore(":memory:");
  const now = 1_700_000_100;
  store.upsertItems([it("hn", "top", "1", "Dagger 1.0", "body", now - 10, 4), { ...it("hn", "top", "2", "", "r", now), threadId: "1", parentId: "1" }], now);
  const got = store.itemsSince(now - 100);
  assert.equal(got.length, 1, "only root threads are listed");
  assert.equal(got[0].meta.replies, 4);
  store.saveDigest({ id: "abc", label: "Dagger", sources: ["hn", "4chan"], itemCount: 2, firstTime: now, lastTime: now, status: "pending", payload: { raw: [] }, updatedAt: now });
  assert.equal(store.getDigest("abc").label, "Dagger");
  assert.equal(store.listDigests(0).length, 1);
  store.close();
});

test("refresh without an API key stores per-community raw views and no AI framing", async () => {
  const store = openStore(":memory:");
  const now = 1_700_000_100;
  store.upsertItems([
    it("hn", "top", "1", "Dagger 1.0 beta released for CI pipelines", "", now - 60),
    it("4chan", "g", "2", "dagger 1.0 beta is out, CI pipelines get faster", "", now - 50),
    it("4chan", "x", "3", "dagger 1.0 beta and CI pipelines, strange signal", "", now - 40),
  ], now);
  const report = await refresh({ store, env: {}, now });
  assert.equal(report.stories, 1);
  const d = store.listDigests(0)[0];
  assert.equal(d.status, "pending");
  assert.equal(d.payload.raw.length, 3, "one raw view per community");
  assert.match(d.payload.reason, /ANTHROPIC_API_KEY/);
  assert.ok(d.label.length > 0);
  assert.equal(d.rare, "rare combo", "story with /x/ and other sources is flagged rare");
  store.close();
});

test("refresh with a mocked model stores framed output", async () => {
  const store = openStore(":memory:");
  const now = 1_700_000_100;
  store.upsertItems([
    it("hn", "top", "1", "Dagger 1.0 beta released for CI pipelines", "The cache works well in practice.", now - 60),
    it("4chan", "g", "2", "dagger 1.0 beta is out, CI pipelines get faster", "It is overhyped and the config is bad.", now - 50),
  ], now);
  const framing = {
    summary: "Dagger 1.0 beta shipped with faster CI.",
    communities: [
      { community: "hn/top", claims: ["fast"], tone: "positive", blame: "none", quotes: [{ postId: "1", quote: "cache works well" }, { postId: "1", quote: "The cache works well in practice" }] },
      { community: "4chan/g", claims: ["overhyped"], tone: "sceptical", blame: "the config", quotes: [{ postId: "2", quote: "It is overhyped" }, { postId: "2", quote: "the config is bad" }] },
    ],
  };
  const agree = {
    candidates: ["Dagger 1.0 works for CI.", "Dagger is new.", "Dagger has a cache."],
    scores: [0, 1, 2].map(i => ({ scores: { "hn/top": 4 - i, "4chan/g": 3 } })),
    disagreements: [{ topic: "hype", sides: { "hn/top": "fine", "4chan/g": "overhyped" } }, { topic: "config", sides: {} }, { topic: "cache", sides: {} }],
  };
  llm.setTransport(async ({ system, user }) => {
    if (user.includes("Return JSON exactly in this shape") && user.includes("candidates")) return JSON.stringify(agree);
    return JSON.stringify(framing);
  });
  const report = await refresh({ store, env: { ANTHROPIC_API_KEY: "test" }, now });
  assert.equal(report.framed, 1);
  const d = store.listDigests(0)[0];
  assert.equal(d.status, "ready");
  assert.equal(d.payload.summary, "Dagger 1.0 beta shipped with faster CI.");
  assert.equal(d.payload.communities.length, 2);
  assert.equal(d.payload.communities[0].quotes[0].url, "https://example.test/hn/top/1");
  assert.equal(d.payload.disagreements.length, 3);
  store.close();
});
