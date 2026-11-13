// OpenAI clients for "Talk to them" and full web-run councils. Both use the same
// OPENAI_API_KEY and GPT-6 Luna model, with council calls additionally supporting JSON schema.
import { env } from "./env.mjs";

const URL = "https://api.openai.com/v1/chat/completions";
const RETRY = new Set([429, 500, 502, 503, 529]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const CHAT_MODEL = "gpt-6-luna";
export const COUNCIL_MODEL = process.env.COUNCIL_MODEL || env("COUNCIL_MODEL") || CHAT_MODEL;
// Reasoning models spend output tokens on hidden thinking before they write. A cap that
// fits a Sonnet answer can leave a reasoning model with nothing left to say, so the
// default is generous and CHAT_MAX_TOKENS overrides it.
export const CHAT_MAX_TOKENS = Number(process.env.CHAT_MAX_TOKENS || env("CHAT_MAX_TOKENS") || 2500);
export const hasChatKey = () => Boolean(env("OPENAI_API_KEY"));

// Running totals, shown in the chat footer so a long conversation never surprises anyone.
export const chatUsage = { calls: 0, prompt: 0, completion: 0, cached: 0 };
export const councilUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 };

// A failed reply should read like a sentence, not like a JSON blob.
function explain(status, body) {
  if (status === 401) return "OpenAI rejected the key. Check OPENAI_API_KEY in .env.";
  if (status === 402) return "OpenAI billing is not enabled for this API account. Check your OpenAI API billing settings.";
  if (status === 403) return "This OpenAI account is not allowed to use the requested model. Check model access for the API project.";
  if (status === 404) return "OpenAI could not find GPT-6 Luna. Check that the model is available to your API project.";
  if (status === 429) return "OpenAI rate or usage limit reached. Check API usage and billing, or try again later.";
  return `OpenAI API error ${status}: ${body}`;
}

function headers() {
  return {
    Authorization: `Bearer ${env("OPENAI_API_KEY")}`,
    "content-type": "application/json",
  };
}

function systemText(system) {
  return Array.isArray(system) ? system.map((part) => part.text || "").join("\n\n") : String(system || "");
}

function addCouncilUsage(usage = {}) {
  councilUsage.input += usage.prompt_tokens || 0;
  councilUsage.output += usage.completion_tokens || 0;
  councilUsage.cacheRead += usage.prompt_tokens_details?.cached_tokens || 0;
  councilUsage.calls += 1;
}

async function requestWithRetry(body) {
  if (!hasChatKey()) throw new Error("No OPENAI_API_KEY. Add one to .env to run a council.");
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(URL, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    if (RETRY.has(res.status)) {
      const details = await res.text();
      if (res.status === 429 && /insufficient_quota|billing|quota/i.test(details)) throw new Error(explain(res.status, details));
      if (attempt < 5) { await sleep(Math.min(30000, 2000 * 2 ** attempt)); continue; }
      throw new Error(explain(res.status, details));
    }
    if (!res.ok) throw new Error(explain(res.status, (await res.text()).slice(0, 400)));
    return res;
  }
  throw new Error("OpenAI kept refusing after retries");
}

/** Stream one council seat reply, returning its text and whether it hit the output limit. */
export async function councilStream({ model = COUNCIL_MODEL, system, prompt, maxTokens = 5000, onText = () => {} }) {
  const res = await requestWithRetry({
    model,
    messages: [{ role: "system", content: systemText(system) }, { role: "user", content: prompt }],
    max_completion_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  });
  let text = "";
  let finish = null;
  let called = false;
  let buf = "";
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.error) throw new Error(String(ev.error.message || "OpenAI closed the stream early."));
      const choice = ev.choices?.[0];
      if (choice?.finish_reason) finish = choice.finish_reason;
      const delta = choice?.delta?.content;
      if (delta) { text += delta; onText(delta); }
      if (ev.usage) { addCouncilUsage(ev.usage); called = true; }
    }
  }
  if (!called) { councilUsage.calls += 1; }
  return { text, truncated: finish === "length" };
}

/** Make a single OpenAI call with strict structured JSON output. */
export async function councilJson({ model = COUNCIL_MODEL, system, prompt, schema, maxTokens = 5000 }) {
  const res = await requestWithRetry({
    model,
    messages: [{ role: "system", content: systemText(system) }, { role: "user", content: prompt }],
    max_completion_tokens: maxTokens,
    response_format: { type: "json_schema", json_schema: { name: "council_response", strict: true, schema } },
  });
  const j = await res.json();
  addCouncilUsage(j.usage);
  const choice = j.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("Chair output hit the OpenAI completion token limit");
  if (choice?.message?.refusal) throw new Error(`OpenAI refused the council request: ${choice.message.refusal}`);
  const content = choice?.message?.content;
  if (typeof content !== "string") throw new Error("OpenAI returned no structured council response");
  try { return JSON.parse(content); }
  catch { throw new Error("OpenAI returned invalid JSON for the council response"); }
}

export const S = {
  str: { type: "string" },
  num: { type: "number" },
  int: { type: "integer" },
  bool: { type: "boolean" },
  arr: (items) => ({ type: "array", items }),
  obj: (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false }),
  enum: (...v) => ({ type: "string", enum: v }),
};

/**
 * Stream one reply. `system` is the seat's full prompt, `messages` is the visible
 * conversation. Calls onText(delta) as text arrives and returns the whole reply.
 */
export async function chatStream({ system, messages, maxTokens = CHAT_MAX_TOKENS, onText = () => {} }) {
  if (!hasChatKey()) throw new Error("No OPENAI_API_KEY. Add one to .env to talk to the seats.");

  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(URL, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: [{ role: "system", content: system }, ...messages],
        max_completion_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
    });

    if (RETRY.has(res.status)) {
      const body = await res.text();
      if (res.status === 429 && /insufficient_quota|billing|quota/i.test(body)) throw new Error(explain(res.status, body));
      if (attempt < 5) { await sleep(Math.min(30000, 2000 * 2 ** attempt)); continue; }
      throw new Error(explain(res.status, body));
    }
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      throw new Error(explain(res.status, body));
    }

    let text = "";
    let reasoning = 0;
    let finish = null;
    let buf = "";
    const dec = new TextDecoder();
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let ev;
        try { ev = JSON.parse(payload); } catch { continue; }
        if (ev.error) throw new Error(String(ev.error.message || "OpenAI closed the stream early."));
        const d = ev.choices?.[0]?.delta;
        const fr = ev.choices?.[0]?.finish_reason;
        if (fr) finish = fr;
        if (d?.reasoning) reasoning += String(d.reasoning).length;
        const delta = d?.content;
        if (delta) { text += delta; onText(delta); }
        if (ev.usage) {
          chatUsage.prompt += ev.usage.prompt_tokens || 0;
          chatUsage.completion += ev.usage.completion_tokens || 0;
          chatUsage.cached += ev.usage.prompt_tokens_details?.cached_tokens || 0;
        }
      }
    }
    chatUsage.calls += 1;
    // A reasoning model can burn the whole budget thinking and never answer.
    if (!text.trim() && reasoning > 0) {
      throw new Error(`The model used its whole ${maxTokens}-token budget on internal reasoning and never answered. Raise CHAT_MAX_TOKENS in .env.`);
    }
    return { text, truncated: finish === "length" };
  }
  throw new Error("OpenAI kept refusing after retries");
}
