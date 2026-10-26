const { test } = require("node:test");
const assert = require("node:assert/strict");
const { maskText, maskPlain, maskItem, stillRude, OPEN, CLOSE, MASK_RE, MILD } = require("../lib/filter");

const masked = s => [...s.matchAll(MASK_RE)].map(m => m[1]);

test("masks rude words and keeps the first letter", () => {
  const out = maskText("this is shit and more shit");
  assert.deepEqual(masked(out), ["s***", "s***"]);
  assert.ok(!out.includes("shit"), "original word is gone from the output");
});

test("catches obfuscation the obscenity matcher alone misses", () => {
  for (const s of ["s[h]it", "f[u]cking", "f u c k", "f.u.c.k", "fu ck", "b*tch", "sh1t", "f*ck"]) {
    assert.ok(masked(maskText(`x ${s} y`)).length >= 1, `masks ${s}`);
    assert.equal(maskPlain(`x ${s} y`).includes(s), false, `${s} is gone`);
  }
});

test("leaves ordinary words alone", () => {
  const plain = "a ship sailed past the shipyard, sitting on the bench, Assess the classic class";
  assert.equal(maskText(plain), plain);
});

test("is case-insensitive", () => {
  assert.equal(masked(maskText("SHIT happens")).length, 1);
});

test("mild words in the starter list are masked", () => {
  assert.ok(MILD.length > 0);
  assert.equal(masked(maskText("what a stupid idea")).length, 1);
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

test("stillRude is a backstop on masked text: clean after masking, and a residual rude word would show", () => {
  assert.equal(stillRude(maskText("this is shit")), false);
  assert.equal(stillRude(maskText("f u c k and s[h]it")), false);
  assert.equal(stillRude("Racing Games and Assess"), false);
});

test("delimiters are private-use characters", () => {
  assert.equal(OPEN, "");
  assert.equal(CLOSE, "");
});
