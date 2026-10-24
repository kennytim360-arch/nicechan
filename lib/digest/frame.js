// Per-community framing and agreement. Everything sent to the model is masked first (same filter as Safe mode).
// Quotes are accepted only if they appear verbatim in the masked source post they name.
const { maskPlain } = require("../filter");
const { excerpt } = require("../text");
const llm = require("./llm");

const norm = s => String(s || "").replace(/\s+/g, " ").trim();
const MAX_POSTS_PER_COMMUNITY = 8;

// Groups a story's items by community, keeping the full count for minority checks.
// One column per forum. A forum's sub-feeds (Hacker News top and new) merge into one column.
// 4chan is the exception: each board is its own column, because boards are separate communities.
function columnKey(it) {
  return it.source === "4chan" ? `4chan/${it.community}` : it.source;
}

function groupByCommunity(items) {
  const map = new Map();
  for (const it of items) {
    const key = columnKey(it);
    if (!map.has(key)) map.set(key, { key, source: it.source, community: it.source === "4chan" ? it.community : null, count: 0, items: [] });
    const g = map.get(key);
    g.count++;
    g.items.push(it);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// What the model sees: masked titles and excerpts, grouped by community.
function modelPosts(groups) {
  return groups.map(g => ({
    community: g.key,
    posts: g.items.slice(0, MAX_POSTS_PER_COMMUNITY).map(it => ({
      postId: it.postId,
      title: maskPlain(it.title || ""),
      text: maskPlain(excerpt(it.text || "", 600)),
    })),
  }));
}

const FRAME_SYSTEM =
  "You summarise how different online communities discuss one news event. Use only the posts you are given. " +
  "Reply with a single JSON object and nothing else.";

function frameUser(label, groups) {
  return [
    `Story: ${label}`,
    "Communities and their posts (JSON):",
    JSON.stringify(modelPosts(groups)),
    "",
    "Return JSON exactly in this shape:",
    '{"summary": "one neutral paragraph on what happened, no opinion",',
    ' "communities": [{"community": "<key from the input>", "claims": ["main claim", "..."],',
    '   "tone": "short description", "blame": "who or what is blamed or credited, or none",',
    '   "quotes": [{"postId": "<postId from that community>", "quote": "copied exactly from that post, 8 to 200 characters"}]}]}',
    "Rules: 2 to 4 quotes per community. Each quote must be copied exactly from the post with that postId. Use only community keys from the input.",
  ].join("\n");
}

// Checks the model's framing against the input. Returns { ok, errors }.
function verifyFrame(out, groups) {
  const errors = [];
  const byKey = new Map(groups.map(g => [g.key, g]));
  if (!out || typeof out.summary !== "string" || !out.summary.trim()) errors.push("summary is missing");
  if (!Array.isArray(out?.communities)) errors.push("communities must be an array");
  else {
    for (const c of out.communities) {
      const g = byKey.get(c.community);
      if (!g) { errors.push(`unknown community ${c.community}`); continue; }
      if (!Array.isArray(c.claims) || !c.claims.length) errors.push(`${c.community}: claims missing`);
      if (typeof c.tone !== "string" || typeof c.blame !== "string") errors.push(`${c.community}: tone or blame missing`);
      const posts = new Map(g.items.slice(0, MAX_POSTS_PER_COMMUNITY).map(it => [it.postId, it]));
      const want = Math.min(2, posts.size);
      if (!Array.isArray(c.quotes) || c.quotes.length < want || c.quotes.length > 4) {
        errors.push(`${c.community}: needs ${want} to 4 quotes`);
        continue;
      }
      for (const q of c.quotes) {
        const it = posts.get(String(q.postId));
        if (!it) { errors.push(`${c.community}: quote names unknown postId ${q.postId}`); continue; }
        const source = norm(maskPlain(`${it.title || ""} ${excerpt(it.text || "", 600)}`));
        const quote = norm(maskPlain(String(q.quote || "")));
        if (quote.length < 8 || !source.includes(quote)) errors.push(`${c.community}: quote not found verbatim in post ${q.postId}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

async function frameCluster(label, groups, { maxAttempts = 3, env = process.env } = {}) {
  let user = frameUser(label, groups);
  let last = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const text = await llm.complete({ system: FRAME_SYSTEM, user, env });
    let out;
    try {
      out = llm.parseJSON(text);
    } catch (err) {
      last = [err.message];
    }
    if (out) {
      const v = verifyFrame(out, groups);
      if (v.ok) return out;
      last = v.errors;
    }
    user = frameUser(label, groups) + `\n\nYour previous answer was rejected: ${last.slice(0, 5).join("; ")}. Fix these and return JSON only.`;
  }
  throw new Error(`framing failed verification: ${last.slice(0, 3).join("; ")}`);
}

// Agreement step: 3 candidate common-ground statements, each scored 1-5 by every community, plus 3 disagreements.
const CONSENSUS_SYSTEM = FRAME_SYSTEM;

function consensusUser(label, framed) {
  return [
    `Story: ${label}`,
    "Per-community framing (JSON):",
    JSON.stringify(framed.map(c => ({ community: c.key, claims: c.claims, tone: c.tone, blame: c.blame }))),
    "",
    "Return JSON exactly in this shape:",
    '{"candidates": ["statement 1", "statement 2", "statement 3"],',
    ' "scores": [{"candidate": 0, "scores": {"<community key>": 1}}, ...],',
    ' "disagreements": [{"topic": "...", "sides": {"<community key>": "that community\'s position"}}, ...]}',
    "Rules: 3 candidates of common ground that all communities could accept, worded neutrally. Score each candidate 1 to 5 for how well it represents each community's own view, from that community's perspective. Give exactly 3 disagreements between communities.",
  ].join("\n");
}

function verifyConsensus(out, framed) {
  const errors = [];
  const keys = framed.map(c => c.key);
  if (!Array.isArray(out?.candidates) || out.candidates.length !== 3 || out.candidates.some(c => typeof c !== "string" || !c.trim())) errors.push("need 3 candidate statements");
  if (!Array.isArray(out?.scores) || out.scores.length !== 3) errors.push("need scores for 3 candidates");
  else for (const s of out.scores) {
    for (const k of keys) {
      const v = s?.scores?.[k];
      if (!Number.isInteger(v) || v < 1 || v > 5) errors.push(`score for ${k} must be an integer 1-5`);
    }
  }
  if (keys.length > 1 && (!Array.isArray(out?.disagreements) || out.disagreements.length !== 3)) errors.push("need exactly 3 disagreements");
  return { ok: errors.length === 0, errors };
}

// Pure choice logic, so it can be tested without a model.
// Picks the candidate with the best worst-case score. Flags when a minority community decides the result.
function chooseCommonGround(candidates, scores, counts) {
  const keys = Object.keys(counts);
  const total = keys.reduce((a, k) => a + counts[k], 0);
  const minority = new Set(keys.filter(k => counts[k] < total / 3));
  const worst = s => Math.min(...keys.map(k => s[k]));
  const mean = s => keys.reduce((a, k) => a + s[k], 0) / keys.length;

  const rank = list => list.slice().sort((a, b) => worst(b.s) - worst(a.s) || mean(b.s) - mean(a.s));
  const all = candidates.map((text, i) => ({ i, text, s: scores[i] }));
  const best = rank(all)[0];

  // Minority carried the result when the winner changes if minority communities are ignored.
  let minorityCarried = false;
  const majorityKeys = keys.filter(k => !minority.has(k));
  if (minority.size && majorityKeys.length >= 2) {
    const trimmed = rank(all.map(c => ({ ...c, s: Object.fromEntries(majorityKeys.map(k => [k, c.s[k]])) })));
    minorityCarried = trimmed[0].i !== best.i;
  }
  return {
    text: best.text,
    worstCase: worst(best.s),
    scores: Object.fromEntries(keys.map(k => [k, best.s[k]])),
    minorityCarried,
    minorityNote: minorityCarried
      ? "A minority community's view decided this statement. Read the per-community columns before relying on it."
      : null,
  };
}

async function consensus(label, framed, { maxAttempts = 2, env = process.env } = {}) {
  const counts = Object.fromEntries(framed.map(c => [c.key, c.count]));
  let user = consensusUser(label, framed);
  let last = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const text = await llm.complete({ system: CONSENSUS_SYSTEM, user, env });
    let out;
    try { out = llm.parseJSON(text); } catch (err) { last = [err.message]; }
    if (out) {
      const v = verifyConsensus(out, framed);
      if (v.ok) {
        const pick = chooseCommonGround(out.candidates.map(c => maskPlain(c)), out.scores.map(s => s.scores), counts);
        return {
          commonGround: pick.text,
          commonGroundScore: { worstCase: pick.worstCase, perCommunity: pick.scores },
          minorityCarried: pick.minorityCarried,
          minorityNote: pick.minorityNote,
          disagreements: (out.disagreements || []).slice(0, 3).map(d => ({
            topic: maskPlain(String(d.topic || "")),
            sides: Object.fromEntries(Object.entries(d.sides || {}).map(([k, v]) => [k, maskPlain(String(v))])),
          })),
        };
      }
      last = v.errors;
    }
    user = consensusUser(label, framed) + `\n\nYour previous answer was rejected: ${last.join("; ")}. Fix these and return JSON only.`;
  }
  throw new Error(`agreement step failed: ${last.slice(0, 3).join("; ")}`);
}

module.exports = {
  columnKey,
  groupByCommunity,
  modelPosts,
  verifyFrame,
  frameCluster,
  verifyConsensus,
  chooseCommonGround,
  consensus,
};
