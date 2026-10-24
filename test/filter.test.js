const { test } = require("node:test");
const assert = require("node:assert/strict");
const { maskText, maskItem, OPEN, CLOSE, MASK_RE, BLOCKED_WORDS } = require("../lib/filter");

const masked = s => [...s.matchAll(MASK_RE)].map(m => m[1]);

test("masks blocked words and keeps the first letter", () => {
  const out = maskText("this is shit and more shit");
  assert.deepEqual(masked(out), ["s***", "s***"]);
  assert.ok(!out.includes("shit"), "original word is gone from the output");
});

test("catches simple obfuscation", () => {
  for (const s of ["sh1t", "f u c k", "fuuuuck", "p0rn", "f*ck"]) {
    assert.equal(masked(maskText(`x ${s} y`)).length, 1, `masks ${s}`);
  }
});

test("leaves ordinary words alone", () => {
  const plain = "a ship sailed past the shipyard, sitting on the bench";
  assert.equal(maskText(plain), plain);
});

test("is case-insensitive and word-start anchored", () => {
  assert.equal(masked(maskText("SHIT happens")).length, 1);
  assert.equal(masked(maskText("bigshit")).length, 0, "does not match inside a longer word");
});

test("maskItem covers title, text and author, and leaves other fields alone", () => {
  const it = { title: "stupid title", text: "an idiot wrote this", author: "moron", url: "https://x", meta: { replies: 2 } };
  const out = maskItem(it);
  for (const v of [out.title, out.text, out.author]) {
    assert.equal(v.includes("stupid") || v.includes("idiot") || v.includes("moron"), false);
  }
  assert.equal(out.url, "https://x");
  assert.deepEqual(out.meta, { replies: 2 });
});

test("starter list is present and delimiters are private-use characters", () => {
  assert.ok(BLOCKED_WORDS.length > 5);
  assert.equal(OPEN, "");
  assert.equal(CLOSE, "");
});
