import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

process.env.OPENAI_API_KEY = "test-openai-key";
const { startCouncil, getSession } = await import("../lib/council.mjs");

const seats = ["hormozi", "graham", "buffett"];
const options = [
  { id: "A", label: "Raise all clients" },
  { id: "B", label: "Raise new clients only" },
  { id: "C", label: "Keep the current price" },
];
const card = (round) => round === 3
  ? `SEAT: Advisor\nVOTE: Endorse with amendment\nOPTION SCORES: A 6/10 · B 8/10 · C 4/10\nFINAL SCORE: 8/10\nFINAL PILLAR SCORE: 7/10\nAMENDMENT OR DISSENT: Track close rate.\nONE LINE FOR THE FOUNDER: Protect the current clients.`
  : round === 2
    ? `SEAT: Advisor\nI DISAGREE MOST WITH: Graham. Test the offer first.\nI CONCEDE: Delivery capacity is unknown.\nON THE CRUXES: 1. Test the higher price.\nSTANCE: Yes\nOPTION SCORES: A 6/10 · B 8/10 · C 4/10\nPILLAR SCORE: 7/10\nCONFIDENCE: 3/5\nRUIN RISK: possible\nMOVED: no\nMY CONDITIONS FOR YES: Track conversions.`
    : `SEAT: Advisor\nSTANCE: Yes\nOPTION SCORES: A 6/10 · B 8/10 · C 4/10\nPILLAR SCORE: 7/10\nCONFIDENCE: 3/5\nRUIN RISK: possible\nDOOR: two-way\nTHE CALL: Choose B and test the new price.\nWHY:\n1. Test willingness to pay (S001).\n2. Protect the current book.\n3. Measure delivery cost.\nTHE RISK I SEE: The offer does not convert.\nWHAT WOULD CHANGE MY MIND: A 30% close rate.\nWHAT I'D DO THIS WEEK: Offer the new price.\nQUESTION FOR THE FOUNDER: How much capacity remains?`;

function chairResponse(prompt) {
  if (prompt.includes("Set up the room.")) return {
    title: "Test coaching prices",
    decision: "Choose a pricing policy.",
    brief: "A coaching business wants to test a higher price.",
    options,
    assumptions: ["Unknown costs remain assumptions."],
    weights: seats.map((seat) => ({ seat, weight: 2, reason: "Material to this decision." })),
    quick_seats: seats,
    seats,
  };
  if (prompt.includes("ROUND 1 CARDS")) return {
    cruxes: [{ question: "Will the higher price convert?", sides: [{ position: "Test first", seats }] }],
    unanimous: true,
    note: "Test price and capacity.",
    pressure: [],
  };
  if (prompt.includes("Interim weighted option scores")) return {
    option: "B",
    label: "GO WITH CONDITIONS",
    recommendation: "Test before changing the current book.",
    conditions: ["Track close rate."],
    next_steps: ["Offer the new price."],
    cheapest_test: "Use the next ten qualified calls.",
    kill_criteria: "Stop if conversion is too low.",
  };
  return {
    label: "GO WITH CONDITIONS",
    call: "Test $3,500 with new clients before changing the existing book.",
    override_note: "",
    why: [{ point: "Testing preserves reversibility.", seat: "Hormozi", framework: "Price test" }],
    fights: [{ crux: "Price conversion", story: "All seats favor testing first." }],
    minority: { seat: "Buffett", quote: "Protect the current book.", would_have_to_be_true: "Current clients accept the increase." },
    amendments: [{ seat: "Hormozi", amendment: "Track close rate.", adopted: true, reason: "It makes the test measurable." }],
    conditions: ["Track conversion and delivery."],
    next_steps: [{ when: "This week", action: "Offer $3,500 to new prospects." }],
    cheapest_test: "Test with new prospects.",
    kill_criteria: "Stop below the conversion floor.",
    revisit: "Review after ten calls.",
  };
}

test("confirmed web setup runs three rounds, scoring, verdict, and saved report through OpenAI", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    if (!body.stream) {
      const prompt = body.messages.at(-1).content;
      assert.equal(prompt.includes("Set up the room."), false, "a confirmed intake must not be replaced by another unconfirmed setup");
      const result = chairResponse(prompt);
      return Response.json({ choices: [{ message: { content: JSON.stringify(result) }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
    }
    const prompt = body.messages.at(-1).content;
    const round = prompt.includes("ROUND 3 OF 3") ? 3 : prompt.includes("ROUND 2 OF 3") ? 2 : 1;
    const text = card(round);
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 20 } })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(chunks)); controller.close(); } }), { status: 200 });
  };

  let session;
  try {
    const preflight = {
      title: "Test coaching prices",
      decision: "Choose a pricing policy.",
      brief: "A coaching business wants to test a higher price.",
      options,
      assumptions: ["Unknown costs remain assumptions."],
      weights: seats.map((seat) => ({ seat, weight: 2, reason: "Material to this decision." })),
      seats,
      quick_seats: seats,
    };
    session = startCouncil("Should I raise coaching prices? The goal is $45k/month.", "full", seats, preflight);
    const end = Date.now() + 20000;
    while (getSession(session.id)?.status === "running" && Date.now() < end) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const finished = getSession(session.id);
    assert.equal(finished.status, "done");
    const setup = finished.events.find((event) => event.type === "setup");
    assert.deepEqual(setup.seats, seats);
    assert.deepEqual(finished.events.filter((event) => event.type === "round_done").map((event) => event.round), [1, 2, 3]);
    assert.ok(finished.events.some((event) => event.type === "verdict"));
    assert.ok(fs.existsSync(`${finished.dir}/verdict.md`));
    assert.ok(fs.existsSync(`${finished.dir}/round-1.md`));
    assert.ok(fs.existsSync(`${finished.dir}/round-2.md`));
    assert.ok(fs.existsSync(`${finished.dir}/round-3.md`));
  } finally {
    globalThis.fetch = originalFetch;
    if (session?.dir && fs.existsSync(session.dir)) fs.rmSync(session.dir, { recursive: true, force: true });
  }
});
