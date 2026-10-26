// Model client. Two providers, no SDK:
//   local   Ollama, e.g. OLLAMA_MODEL=qwen3:8b (or phi4-mini). Tried first when OLLAMA_MODEL is set.
//   hosted  Anthropic Messages API. Used as the fallback when local output fails the verbatim-quote check,
//           and as the only provider when OLLAMA_MODEL is not set. Set ANTHROPIC_MODEL to a cheap model for the fallback.
// Secrets come from the environment and are never logged. Every prompt is masked before it reaches either provider.
const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const URL_ = "https://api.anthropic.com/v1/messages";

let transport = null; // tests replace this with a fake model: ({ provider, system, user, model, maxTokens }) => text

function config(env = process.env) {
  return { apiKey: env.ANTHROPIC_API_KEY || "", model: env.ANTHROPIC_MODEL || DEFAULT_MODEL };
}

function localConfig(env = process.env) {
  return { url: (env.OLLAMA_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, ""), model: env.OLLAMA_MODEL || "" };
}

// Providers in the order they are tried. Local first when configured, then hosted.
function chain(env = process.env) {
  const out = [];
  if (localConfig(env).model) out.push({ name: "local", model: localConfig(env).model });
  out.push({ name: "hosted", model: config(env).model });
  return out;
}

function enabled(env = process.env) {
  return !!config(env).apiKey || !!localConfig(env).model;
}

async function ollama({ system, user, maxTokens, env }) {
  const { url, model } = localConfig(env);
  const r = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: false,       // Qwen3 and similar: no hidden reasoning, just the JSON
      format: "json",
      options: { temperature: 0.2, num_predict: maxTokens },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`local model returned ${r.status}`);
  const d = await r.json();
  return d.message?.content ?? "";
}

async function hosted({ system, user, maxTokens, env }) {
  const { apiKey, model } = config(env);
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

// `provider` is "local" or "hosted". Defaults to the first provider in the chain.
async function complete({ system, user, maxTokens = 2000, env = process.env, provider = chain(env)[0].name }) {
  const model = chain(env).find(p => p.name === provider)?.model;
  if (transport) return transport({ provider, system, user, model, maxTokens });
  if (provider === "local") return ollama({ system, user, maxTokens, env });
  return hosted({ system, user, maxTokens, env });
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
  localConfig,
  chain,
  setTransport: fn => { transport = fn; },
};
