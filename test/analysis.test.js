// Analysis tests. No model, no network.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const mood = require("../lib/analysis/mood");
const { topWords } = require("../lib/analysis/words");
const { normalizeUrl, linksOf } = require("../lib/analysis/links");
const { analyseStory } = require("../lib/analysis/story");
const { cluster } = require("../lib/digest/cluster");

const item = (source, community, postId, o = {}) => ({
  source, community, threadId: o.threadId ?? postId, postId, parentId: null, author: o.author ?? "anon",
  time: o.time ?? 1_700_000_000, title: o.title ?? "", text: o.text ?? "", url: `https://example.test/${source}/${postId}`,
  score: o.score ?? null, thumb: null, meta: o.meta ?? {},
});

test("mood: positive, negative, negated, and no-signal text", () => {
  assert.ok(mood.score("this is great and fast") > 0);
  assert.ok(mood.score("this is terrible and broken") < 0);
  assert.ok(mood.score("not good at all") < 0, "negation flips the sign");
  assert.equal(mood.score("the table is brown"), null, "no scored words gives null");
  const avg = mood.average(["great", "awful", "the table"]);
  assert.ok(avg !== null && Math.abs(avg) < 1);
});

test("word counts ignore stop words and count each word once per text", () => {
  const top = topWords(["privacy and lock-in matter", "privacy ads privacy", "ads and privacy"], { n: 5 });
  assert.equal(top[0].word, "privacy");
  assert.equal(top[0].count, 3);
  assert.ok(!top.some(t => t.word === "and"));
});

test("links are normalised so the same article matches", () => {
  assert.equal(normalizeUrl("https://www.Example.com/a/?utm_source=x&id=2#top"), "example.com/a?id=2");
  assert.equal(normalizeUrl("https://example.com/a"), normalizeUrl("http://m.example.com/a/"));
  assert.equal(normalizeUrl("javascript:alert(1)"), null);
});

test("linksOf reads the external link and links written in the text", () => {
  const it2 = item("4chan", "g", "1", { text: "see https://news.example.com/story?utm_medium=y." });
  it2.meta = { externalUrl: "https://www.news.example.com/story" };
  assert.deepEqual(linksOf(it2), ["news.example.com/story"]);
});

test("stories are grouped by a shared link even when titles differ", () => {
  const link = "https://paper.example.org/study";
  const items = [
    { ...item("hn", "top", "1", { title: "Interesting result" }), meta: { externalUrl: link } },
    { ...item("lemmy", "technology", "2", { title: "Completely different words here" }), meta: { externalUrl: link } },
    item("manifold", "markets", "3", { title: "Will it rain in Paris" }),
  ];
  const groups = cluster(items);
  const g = groups.find(x => x.items.some(i => i.postId === "1"));
  assert.ok(g.items.some(i => i.postId === "2"), "shared link joins the group");
  assert.ok(!g.items.some(i => i.postId === "3"));
});

test("analyseStory gives per-forum stats, the top comment, shared links and posters", () => {
  const now = 1_700_100_000;
  const threads = [
    { ...item("hn", "top", "1", { title: "Privacy and ads in apps", time: now - 3600, meta: { replies: 3 } }), score: 120, meta: { externalUrl: "https://a.example/x" } },
    { ...item("4chan", "g", "2", { title: "Privacy and ads again", time: now - 3000 }), meta: { replies: 1 } },
    { ...item("lemmy", "technology", "3", { title: "Privacy ads are bad", time: now - 2000 }), score: 5, meta: { externalUrl: "https://a.example/x" } },
  ];
  const posts = [
    ...threads,
    item("lemmy", "technology", "30", { threadId: "3", text: "Ads are awful and privacy is broken", time: now - 500, author: "dendrite", score: 40 }),
    item("lemmy", "technology", "31", { threadId: "3", text: "This is great and fast", time: now - 400, author: "dendrite", score: 3 }),
    item("4chan", "g", "20", { threadId: "2", text: "privacy ads everywhere lol", time: now - 300, author: "Anonymous" }),
  ];
  const a = analyseStory({ threads, posts, now });
  const lemmy = a.forums.find(f => f.key === "lemmy");
  assert.equal(lemmy.threads, 1);
  assert.equal(lemmy.posts, 3);
  assert.equal(lemmy.topComment.score, 40, "most upvoted comment is picked from scores");
  assert.equal(lemmy.topPosters[0].author, "dendrite");
  assert.ok(lemmy.mood !== null);
  const hn = a.forums.find(f => f.key === "hn");
  assert.equal(hn.topComment, null, "a forum with no comment scores says so");
  assert.ok(!hn.topWords.some(w => w.word === "privacy"), "words from the story title are skipped");
  assert.ok(a.sharedLinks.some(l => l.url === "a.example/x" && l.forums.length === 2));
  assert.equal(a.counts.threads, 3);
});

test("aspects: a post raises an aspect only when a keyword matches", () => {
  const { aspectsOf } = require("../lib/analysis/aspects");
  assert.deepEqual(aspectsOf("the new tracker leaks privacy data"), ["privacy"]);
  assert.ok(aspectsOf("layoffs and hiring freeze").includes("jobs"));
  assert.deepEqual(aspectsOf("the table is brown"), []);
});

test("analyseStory reports which forums raised each aspect and which stayed silent", () => {
  const now = 1_700_100_000;
  const threads = [
    { ...item("hn", "top", "1", { title: "New bill passes", time: now - 3600 }), score: 50 },
    { ...item("4chan", "g", "2", { title: "New bill passes", time: now - 3000 }) },
  ];
  const posts = [
    ...threads,
    item("lemmy", "technology", "3", { threadId: "1", text: "This privacy law is good", time: now - 500 }),
  ];
  const a = analyseStory({ threads, posts, now });
  const privacy = a.aspectGrid.find(g => g.aspect === "privacy");
  assert.deepEqual(privacy.raisedBy, ["lemmy"]);
  assert.ok(privacy.silent.includes("hn") && privacy.silent.includes("4chan/g"));
  assert.deepEqual(a.forumKeys.sort(), ["4chan/g", "hn", "lemmy"].sort());
});
