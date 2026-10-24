// Word counts per forum: the words each forum uses most. Plain counting, no model.
const STOP = new Set((
  "about after again against also another because been before being below between both could would should " +
  "does doing down during each even every from further have here into just like more most much must never " +
  "only other over same since some such than that their them then there these they this those through to " +
  "under until very what when where which while who whom why will with your yours hers ours theirs were " +
  "they're you're it's i'm don't isn't can't won't didn't wasn't aren't they've we've i've you've " +
  "https http www com amp quot gt lt nbsp the and for are but not all any its one two out off our his her " +
  "she him was had get got make made know think want going really people thing things anyone someone"
).split(/\s+/));

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ")
    .match(/[a-z][a-z'-]{3,}/g) || [];
}

// Top words across a list of texts. `skip` removes words the story itself is about (for example its title words).
function topWords(texts, { n = 8, skip = new Set() } = {}) {
  const counts = new Map();
  for (const t of texts) {
    for (const w of new Set(tokens(t))) {
      if (STOP.has(w) || skip.has(w)) continue;
      counts.set(w, (counts.get(w) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([word, count]) => ({ word, count }));
}

module.exports = { topWords, tokens };
