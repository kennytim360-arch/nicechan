// Home-page rules: neutral story titles, excluded 4chan threads, and the local-then-hosted model chain.
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { pickLabel } = require("../lib/digest/pipeline");
const { IMAGE_GEN } = require("../lib/sources/4chan");
const { frameCluster, groupByCommunity } = require("../lib/digest/frame");
const llm = require("../lib/digest/llm");

afterEach(() => llm.setTransport(null));

const it = (source, community, postId, title, replies = 0, text = "") => ({
  source, community, threadId: postId, postId, parentId: null, author: "a", time: 1_700_000_000, title, text,
  url: `https://example.test/${source}/${postId}`, score: null, thumb: null, meta: { replies },
});

test("a story takes its title from a non-4chan forum, even when 4chan has more replies", () => {
  const { label, labelSource } = pickLabel([
    it("4chan", "news", "1", "crude 4chan title", 900),
    it("lemmy", "news", "2", "Neutral headline from Lemmy", 12),
  ]);
  assert.equal(label, "Neutral headline from Lemmy");
  assert.equal(labelSource, null);
});

test("with only 4chan titles, the most-replied one is used and tagged with its board", () => {
  const { label, labelSource } = pickLabel([it("4chan", "g", "1", "less replies", 3), it("4chan", "news", "2", "most replies", 40)]);
  assert.equal(label, "most replies");
  assert.equal(labelSource, "4chan/news");
});

test("threads in image-generation generals are excluded, other /g/ threads are not", () => {
  assert.ok(IMAGE_GEN.test("/sdg/ - Stable Diffusion General"));
  assert.ok(IMAGE_GEN.test("/ldg/ - Local Diffusion General"));
  assert.ok(!IMAGE_GEN.test("/lmg/ - Local Models General"));
  assert.ok(!IMAGE_GEN.test("/g/ - Technology"));
});

test("local model answers first; a failed quote check falls back to the hosted model", async () => {
  const env = { OLLAMA_MODEL: "qwen3:8b", ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-haiku-5-5" };
  const groups = groupByCommunity([
    it("hn", "top", "10", "Dagger 1.0", 0, "The cache works well in practice."),
    it("4chan", "g", "20", "dagger", 0, "It is overhyped and the config is bad."),
  ]);
  const good = {
    summary: "s",
    communities: [
      { community: "hn", claims: ["c"], tone: "t", blame: "none", quotes: [{ postId: "10", quote: "cache works well" }, { postId: "10", quote: "works well in practice" }] },
      { community: "4chan/g", claims: ["c"], tone: "t", blame: "none", quotes: [{ postId: "20", quote: "overhyped" }, { postId: "20", quote: "config is bad" }] },
    ],
  };
  const bad = JSON.parse(JSON.stringify(good));
  bad.communities[0].quotes[0].quote = "an invented sentence";
  const calls = [];
  llm.setTransport(async ({ provider, model }) => {
    calls.push(`${provider}:${model}`);
    return JSON.stringify(provider === "local" ? bad : good);
  });
  const out = await frameCluster("Dagger", groups, { env, maxAttempts: 2 });
  assert.deepEqual(calls.filter(c => c.startsWith("local")).length, 2, "local tried twice");
  assert.equal(calls.at(-1), "hosted:claude-haiku-5-5", "then the cheap hosted fallback");
  assert.equal(out.provider, "hosted");
});

test("with no OLLAMA_MODEL set, only the hosted model is used", () => {
  const chain = llm.chain({ ANTHROPIC_API_KEY: "k" });
  assert.deepEqual(chain.map(p => p.name), ["hosted"]);
  assert.deepEqual(llm.chain({ OLLAMA_MODEL: "phi4-mini" }).map(p => p.name), ["local", "hosted"]);
});
