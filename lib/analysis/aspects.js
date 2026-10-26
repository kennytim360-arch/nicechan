// Fixed list of aspects a discussion can raise. Keyword matching only, no model.
// A post "raises" an aspect when one of its words matches. This is a rough signal: it misses sarcasm
// and context, so the UI shows it as "came up", never as a verdict.
const ASPECTS = {
  privacy: /\b(privacy|private|tracking|tracker|tracked|surveil\w*|data|gdpr|consent|leak\w*)\b/i,
  cost: /\b(cost|costs|price|prices|pricing|expensive|cheap|cheaper|fee|fees|money|paid|subscription|tax|taxes|billion|million)\b/i,
  security: /\b(security|secure|hack\w*|exploit\w*|vulnerab\w*|malware|breach\w*|attack\w*|backdoor)\b/i,
  ethics: /\b(ethic\w*|moral\w*|immoral\w*|rights?|harm\w*|fair|unfair|justice|consent)\b/i,
  jobs: /\b(jobs?|layoffs?|hiring|hire|hired|workers?|employ\w*|salary|salaries|career)\b/i,
  performance: /\b(performance|fast|faster|slow|slower|latency|speed|bench\w*|battery|lag\w*|bug|bugs)\b/i,
  politics: /\b(politic\w*|government|govt|regulat\w*|congress|senate|election\w*|policy|policies|president|parliament|law|laws)\b/i,
  humour: /\b(lol|lmao|haha\w*|joke|jokes|funny|kek|meme\w*)\b/i,
};

const ASPECT_LIST = Object.keys(ASPECTS);

// The aspects a text raises, in the fixed order.
function aspectsOf(text) {
  const s = String(text || "");
  return ASPECT_LIST.filter(a => ASPECTS[a].test(s));
}

module.exports = { ASPECTS, ASPECT_LIST, aspectsOf };
