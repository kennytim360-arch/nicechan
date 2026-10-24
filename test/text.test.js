const { test } = require("node:test");
const assert = require("node:assert/strict");
const { htmlToText, stripMarkdown, isoToUnix, decodeEntities } = require("../lib/text");

test("4chan-style HTML becomes plain text", () => {
  const html = '<a href="#p1" class="quotelink">&gt;&gt;1</a><br>hello &amp; <span class="deadlink">bye</span>';
  assert.equal(htmlToText(html), ">>1\nhello & bye");
});

test("paragraph tags become blank lines", () => {
  assert.equal(htmlToText("<p>one</p><p>two</p>"), "one\n\ntwo");
});

test("entities decode once, so &amp;lt; stays literal", () => {
  assert.equal(decodeEntities("&amp;lt; &#39; &#x2F; &quot;"), "&lt; ' / \"");
});

test("markdown links, images and emphasis are reduced to text", () => {
  assert.equal(stripMarkdown("see [the docs](https://x.y) **now** ![pic](https://img)"), "see the docs now");
});

test("isoToUnix handles microsecond timestamps and bad input", () => {
  assert.equal(isoToUnix("2026-10-24T00:45:04.766487Z"), Math.floor(Date.UTC(2026, 9, 24, 0, 45, 4) / 1000));
  assert.equal(isoToUnix("not a date"), 0);
});
