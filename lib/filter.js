// Server-side content filter for Safe mode and for story titles.
// Word matching is done by the `obscenity` package. It handles leetspeak, repeated letters and f*ck-style masks.
// Its built-in matcher stops at spaces and punctuation, so a second pass also checks each token with separators
// removed (f[u]cking, f.u.c.k, b*tch) and short runs of tokens joined together (f u c k, fu ck).
//
// Every matched span is replaced with a masked token before the response leaves the server, so the original
// word is never sent to the browser while Safe mode is on. The browser shows the token as a masked button.
// Story titles and model input always go through maskPlain. Titles that still look rude after masking are held back.
const o = require("obscenity");

// A small list of mild words the English dataset does not cover. Everything else comes from obscenity.
const MILD = ["stupid", "idiot", "moron"];

const dataset = new o.DataSet().addAll(o.englishDataset);
for (const w of MILD) {
  dataset.addPhrase(p => p.setMetadata({ originalWord: w }).addPattern(o.pattern`|${w}|`));
}
const matcher = new o.RegExpMatcher({ ...dataset.build(), ...o.englishRecommendedTransformers });

// Private-use delimiters: they cannot appear in normal text, and the client escapes everything else.
const OPEN = "";
const CLOSE = "";
const MASK_RE = /([^]*)/g;

const LETTERS = /[^\p{L}\p{N}]/gu;
const VOWELS = ["a", "e", "i", "o", "u"];
const clean = s => s.replace(LETTERS, "");
const hits = s => s.length > 0 && matcher.hasMatch(s);

// Spans [start, end) of rude text in `text`.
function findSpans(text) {
  const spans = [];
  for (const m of matcher.getAllMatches(text)) spans.push([m.startIndex, m.endIndex + 1]);

  // Tokens with separators removed: "f[u]cking" -> "fucking". A star stands for a hidden letter, so b*tch is tried as bitch, batch, and so on.
  const tokens = [...text.matchAll(/\S+/g)].map(m => ({
    start: m.index,
    end: m.index + m[0].length,
    letters: clean(m[0]),
    guesses: m[0].includes("*") ? VOWELS.map(v => clean(m[0].replace(/\*/g, v))) : [],
  }));
  for (const t of tokens) {
    if ((t.letters.length > 2 && hits(t.letters)) || t.guesses.some(g => g.length > 2 && hits(g))) spans.push([t.start, t.end]);
  }

  // Runs of short tokens joined together: "f u c k", "fu ck".
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const squashed = run.map(t => t.letters).join("");
      if (hits(squashed)) spans.push([run[0].start, run[run.length - 1].end]);
    }
    run = [];
  };
  for (const t of tokens) {
    if (t.letters.length > 0 && t.letters.length <= 2) run.push(t);
    else flush();
  }
  flush();

  return mergeSpans(spans);
}

function mergeSpans(spans) {
  const sorted = spans.slice().sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

// Keeps the first letter or digit and hides the rest: "f***".
const mask = raw => `${(raw.match(/[\p{L}\p{N}]/u) || ["*"])[0]}***`;

function maskText(text) {
  if (!text) return text || "";
  const s = String(text);
  let out = "";
  let at = 0;
  for (const [start, end] of findSpans(s)) {
    out += s.slice(at, start) + `${OPEN}${mask(s.slice(start, end))}${CLOSE}`;
    at = end;
  }
  return out + s.slice(at);
}

// Plain masked text for the digest and the model: f*** with no private-use markers.
function maskPlain(text) {
  return maskText(text).replace(/[]/g, "");
}

// True when the text still contains rude words after masking. Used to hold back a story title.
// Masks become spaces first, so nothing is joined across a mask: only what is left unmasked is checked.
function stillRude(text) {
  const left = maskPlain(text).replace(/\*+/g, " ");
  return findSpans(left).length > 0;
}

function maskItem(it) {
  return { ...it, title: maskText(it.title), text: maskText(it.text), author: maskText(it.author) };
}

module.exports = { maskText, maskPlain, maskItem, stillRude, OPEN, CLOSE, MASK_RE, MILD };
