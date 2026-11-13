import assert from "node:assert/strict";
import { test } from "node:test";

process.env.OPENAI_API_KEY = "test-openai-key";
const ai = await import("../lib/openai.mjs");

test("council Chair calls use GPT-6 Luna structured output and the OpenAI key", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({
      choices: [{ message: { content: '{"title":"Test council"}' }, finish_reason: "stop" }],
      usage: { prompt_tokens: 20, completion_tokens: 8 },
    });
  };

  try {
    const result = await ai.councilJson({
      system: "Chair system",
      prompt: "Set up this decision.",
      schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
      maxTokens: 900,
    });
    const payload = JSON.parse(request.options.body);
    assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
    assert.equal(request.options.headers.Authorization, "Bearer test-openai-key");
    assert.equal(payload.model, ai.COUNCIL_MODEL);
    assert.equal(payload.max_completion_tokens, 900);
    assert.deepEqual(payload.response_format, {
      type: "json_schema",
      json_schema: {
        name: "council_response",
        strict: true,
        schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
      },
    });
    assert.deepEqual(result, { title: "Test council" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("council seat calls stream text and report truncation", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    const body = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "SEAT: TEST" } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "length" }] })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(body)); controller.close(); } }), { status: 200 });
  };

  try {
    const deltas = [];
    const result = await ai.councilStream({
      system: "Seat system",
      prompt: "Give your opening position.",
      maxTokens: 1200,
      onText: (text) => deltas.push(text),
    });
    const payload = JSON.parse(request.options.body);
    assert.equal(payload.model, ai.COUNCIL_MODEL);
    assert.equal(payload.stream, true);
    assert.equal(payload.messages[0].role, "system");
    assert.equal(payload.messages[1].content, "Give your opening position.");
    assert.equal(result.text, "SEAT: TEST");
    assert.equal(result.truncated, true);
    assert.deepEqual(deltas, ["SEAT: TEST"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
