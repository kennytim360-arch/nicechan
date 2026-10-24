// Minimal Anthropic Messages API client. No SDK. The key comes from ANTHROPIC_API_KEY and is never logged.
const DEFAULT_MODEL = "claude-sonnet-5-5";
const URL_ = "https://api.anthropic.com/v1/messages";

let transport = null; // tests replace this with a fake model

function config(env = process.env) {
  return { apiKey: env.ANTHROPIC_API_KEY || "", model: env.ANTHROPIC_MODEL || DEFAULT_MODEL };
}

function enabled(env = process.env) {
  return !!config(env).apiKey;
}

async function complete({ system, user, maxTokens = 2000, env = process.env }) {
  const { apiKey, model } = config(env);
  if (transport) return transport({ system, user, model, maxTokens });
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  const r = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!r.ok) throw new Error(`Anthropic API returned ${r.status}`);
  const d = await r.json();
  return d.content.filter(b => b.type === "text").map(b => b.text).join("");
}

// Pulls the first JSON object out of a model reply. Throws if there is none.
function parseJSON(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("model reply had no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

module.exports = {
  complete,
  parseJSON,
  enabled,
  config,
  setTransport: fn => { transport = fn; },
};
