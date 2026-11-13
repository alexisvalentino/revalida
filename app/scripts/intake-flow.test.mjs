import assert from "node:assert/strict";
import { test } from "node:test";

process.env.OPENAI_API_KEY = "test-openai-key";
const intake = await import("../lib/intake.mjs");

const baseResult = {
  ready: false,
  questions: ["What are your monthly costs?", "How many clients can you serve?", "What is your refund rate?"],
  note: "These details affect downside and capacity.",
  title: "Raise coaching prices",
  decision: "Choose a pricing policy.",
  brief: "The founder wants to reach $45k/month.",
  options: [{ id: "A", label: "Raise everyone" }, { id: "B", label: "Raise new clients only" }, { id: "C", label: "Keep current price" }],
  assumptions: [],
  weights: [{ seat: "hormozi", weight: 3, reason: "Pricing is central." }],
  recommended_seats: ["hormozi", "graham", "buffett", "bezos", "martell"],
  quick_seats: ["hormozi", "buffett", "bezos", "graham"],
};

test("web intake asks questions before council setup when decision-critical facts are missing", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: JSON.stringify(baseResult) }, finish_reason: "stop" }] });
  };

  try {
    const result = await intake.reviewCouncilInput({
      input: "Pricing decision: $30k/month, 15 clients, goal $45k/month.",
      answers: [],
      // A stale client cannot turn on the removed assumptions bypass.
      useAssumptions: true,
    });
    assert.equal(request.model, "gpt-6-luna");
    assert.equal(request.messages[0].role, "system");
    assert.match(request.messages[1].content, /Do not start a council/);
    assert.match(request.messages[1].content, /Pricing decision/);
    assert.match(request.messages[0].content, /never treat assumptions as permission to proceed/i);
    assert.equal(result.ready, false);
    assert.equal(result.questions.length, 2);
    assert.equal(result.setup, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("answered intake returns a draft for user confirmation without an assumptions bypass", async () => {
  const originalFetch = globalThis.fetch;
  const readyResult = { ...baseResult, ready: true, questions: [], assumptions: ["Delivery capacity was not provided."] };
  let request;
  globalThis.fetch = async (_url, options) => {
    request = JSON.parse(options.body);
    return Response.json({ choices: [{ message: { content: JSON.stringify(readyResult) }, finish_reason: "stop" }] });
  };

  try {
    const result = await intake.reviewCouncilInput({
      input: "Pricing decision with $30k revenue and a March goal.",
      answers: [{ question: "What are monthly costs?", answer: "About $12k." }],
    });
    assert.match(request.messages[1].content, /Founder answered: About \$12k/);
    assert.doesNotMatch(request.messages[1].content, /founder explicitly chose to proceed/i);
    assert.match(request.messages[1].content, /1 to 2 concise, specific questions/i);
    assert.equal(result.ready, true);
    assert.deepEqual(result.questions, []);
    assert.equal(result.setup.options.length, 3);
    assert.deepEqual(result.setup.seats, baseResult.recommended_seats);
    assert.deepEqual(result.setup.assumptions, ["Delivery capacity was not provided."]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("approved intake is held until explicit start and can only be consumed once", async () => {
  const id = intake.storeIntake("approved founder input", { title: "Approved proposal" });
  assert.equal(intake.consumeIntake("not-a-real-intake"), null);
  assert.deepEqual(intake.consumeIntake(id), { input: "approved founder input", setup: { title: "Approved proposal" } });
  assert.equal(intake.consumeIntake(id), null);
});
