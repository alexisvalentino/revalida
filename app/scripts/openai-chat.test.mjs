import assert from "node:assert/strict";
import { test } from "node:test";

process.env.OPENAI_API_KEY = "test-openai-key";
const client = await import("../lib/openai.mjs");

test("Talk to them streams through OpenAI using GPT-6 Luna by default", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    const body = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello from Luna." }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 4, prompt_tokens_details: { cached_tokens: 0 } } })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(body)); controller.close(); } }), { status: 200 });
  };

  try {
    const deltas = [];
    const result = await client.chatStream({
      system: "You are a test advisor.",
      messages: [{ role: "user", content: "Hello" }],
      model: "gpt-5-nano",
      onText: (text) => deltas.push(text),
    });
    const payload = JSON.parse(request.options.body);

    assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(request.options.headers.Authorization, "Bearer test-openai-key");
    assert.equal(payload.model, "gpt-6-luna");
    assert.equal(payload.max_completion_tokens, client.CHAT_MAX_TOKENS);
    assert.deepEqual(payload.stream_options, { include_usage: true });
    assert.equal(result.text, "Hello from Luna.");
    assert.deepEqual(deltas, ["Hello from Luna."]);
    assert.equal(result.truncated, false);
    assert.equal(client.chatUsage.calls, 1);
    assert.equal(client.chatUsage.prompt, 12);
    assert.equal(client.chatUsage.completion, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
