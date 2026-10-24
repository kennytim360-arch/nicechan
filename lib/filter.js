// Server-side content filter for Safe mode.
// Every matched word is replaced with a masked token before the response leaves the server,
// so the original word is never sent to the browser while Safe mode is on.
// The browser shows the token as a masked span (see public/app.js).
//
// The word list is a starter list. For a public launch, load a maintained list from a file
// (for example the `obscenity` package or LDNOOBW) instead of editing this array.

const BLOCKED_WORDS = [
  "fuck", "shit", "bitch", "bastard", "asshole", "dick", "cunt", "piss",
  "porn", "gore", "nsfw", "retard", "idiot", "moron", "stupid",
];

// Handles simple obfuscation: f*ck, f u c k, fuuuck, sh1t.
const LEET = { a: "[a@4]", e: "[e3]", i: "[i1!|]", o: "[o0]", s: "[s$5]", t: "[t7]", u: "[uv*]" };
function wordToRegex(word) {
  return [...word].map(ch => `(?:${LEET[ch] || ch}[\\W_]*)+`).join("");
}
const RE = new RegExp(`\\b(?:${BLOCKED_WORDS.map(wordToRegex).join("|")})`, "gi");

// Private-use delimiters: they cannot appear in normal text, and the client escapes everything else.
const OPEN = "";
const CLOSE = "";
const MASK_RE = /([^]*)/g;

const mask = word => `${word[0]}***`;

function maskText(text) {
  if (!text) return text || "";
  return String(text).replace(RE, m => `${OPEN}${mask(m)}${CLOSE}`);
}

// Plain masked text for the digest and the model: f*** with no private-use markers.
function maskPlain(text) {
  return maskText(text).replace(/[]/g, "");
}

function maskItem(it) {
  return { ...it, title: maskText(it.title), text: maskText(it.text), author: maskText(it.author) };
}

module.exports = { maskText, maskPlain, maskItem, OPEN, CLOSE, MASK_RE, BLOCKED_WORDS };
