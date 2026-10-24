// Rough mood score from a small word list. No dependencies. Not VADER: it misses sarcasm,
// slang and most context, so read it as a tilt, not a verdict.
const POSITIVE = {
  good: 1, great: 2, nice: 1, love: 2, loved: 2, like: 1, liked: 1, best: 2, excellent: 2, amazing: 2,
  awesome: 2, happy: 2, glad: 1, thanks: 1, thank: 1, helpful: 2, win: 1, wins: 1, won: 1, impressive: 2,
  fast: 1, faster: 1, easy: 1, improve: 1, improved: 1, improvement: 1, works: 1, working: 1, solid: 1,
  fun: 1, cool: 1, smart: 2, brilliant: 2, hope: 1, hopeful: 1, progress: 1, safe: 1, benefit: 1, free: 1,
  support: 1, supported: 1, agree: 1, right: 1, correct: 1, recommend: 1, recommended: 2, peace: 1, wonderful: 2,
};
const NEGATIVE = {
  bad: 1, worse: 2, worst: 2, hate: 2, hated: 2, awful: 2, terrible: 2, horrible: 2, broken: 2, break: 1,
  bug: 1, bugs: 1, fail: 2, fails: 2, failed: 2, failure: 2, scam: 3, lie: 2, lies: 2, lying: 2, liar: 2,
  angry: 2, anger: 2, sad: 1, worried: 1, worry: 1, fear: 2, scary: 2, danger: 2, dangerous: 2, kill: 2,
  killed: 2, death: 2, die: 2, dead: 2, stupid: 2, dumb: 2, useless: 2, slow: 1, expensive: 1, ads: 1,
  spam: 2, leak: 2, leaked: 2, breach: 2, hack: 1, hacked: 2, censor: 2, censored: 2, ban: 1, banned: 2,
  lockin: 2, cringe: 1, trash: 2, garbage: 2, sucks: 2, suck: 2, problem: 1, problems: 1, crisis: 2,
};
const NEGATORS = new Set(["not", "no", "never", "dont", "don't", "isnt", "isn't", "wont", "won't", "cant", "can't", "without"]);

// Score in [-1, 1]. Returns null for text with no scored words.
function score(text) {
  const words = String(text || "").toLowerCase().match(/[a-z']+/g) || [];
  let raw = 0;
  let hits = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const v = POSITIVE[w] ?? (NEGATIVE[w] ? -NEGATIVE[w] : 0);
    if (!v) continue;
    const negated = words.slice(Math.max(0, i - 2), i).some(x => NEGATORS.has(x));
    raw += negated ? -v : v;
    hits++;
  }
  if (!hits) return null;
  return Math.tanh(raw / 3);
}

// Average over a list of texts, ignoring texts with no scored words.
function average(texts) {
  const scores = texts.map(score).filter(s => s !== null);
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

module.exports = { score, average };
