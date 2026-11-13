import { randomUUID } from "node:crypto";
import { SEATS, loadRoster } from "./seats.mjs";
import { councilJson, COUNCIL_MODEL, S } from "./openai.mjs";

const intakes = new Map();
const INTAKE_TTL = 60 * 60 * 1000;

function intakeSchema() {
  loadRoster();
  const seat = S.enum(...SEATS.map((x) => x.key));
  return S.obj({
    ready: S.bool,
    questions: S.arr(S.str),
    note: S.str,
    title: S.str,
    decision: S.str,
    brief: S.str,
    options: S.arr(S.obj({ id: S.enum("A", "B", "C", "D"), label: S.str })),
    assumptions: S.arr(S.str),
    weights: S.arr(S.obj({ seat, weight: S.int, reason: S.str })),
    recommended_seats: S.arr(seat),
    quick_seats: S.arr(seat),
  });
}

/** Review a founder's brief, ask for material missing facts, and return a draft setup only when ready. */
export async function reviewCouncilInput({ input, answers = [] }) {
  const questions = answers.map(({ question, answer }, i) => `${i + 1}. Chair asked: ${question}\n   Founder answered: ${answer}`).join("\n\n") || "(No answers yet.)";
  const raw = await councilJson({
    model: COUNCIL_MODEL,
    system: `You are Revalida's intake Chair. You clarify the founder's question before any advisor council starts. You are not yet running the council. Use only the founder's stated facts. Never treat assumptions as permission to proceed, and never invent a founder answer. Registered seat keys: ${SEATS.map((seat) => seat.key).join(", ")}.`,
    schema: intakeSchema(),
    maxTokens: 6000,
    prompt: `Review this founder's decision and prepare the council intake.

FOUNDER INPUT
${input}

FOLLOW-UP ANSWERS
${questions}

This is an intake/review call only. Do not start a council, write advisor cards, or imply that the founder has approved the brief or chosen the advisors.

If a missing fact could materially change the recommendation, downside, feasibility, or option scores, set ready=false and ask 1 to 2 concise, specific questions. Ask only for facts needed to distinguish the options; prioritize the most decision-changing gaps, avoid repeating answered questions, and do not ask for nice-to-have detail. Ask another small batch only when an answer reveals a new material gap. Stop as soon as the available context is enough to compare the options. A founder may answer with a number, a reasonable estimate, or explain that a fact is genuinely unknown. Treat an explicit unknown as uncertainty to analyze—not as permission to invent or silently assume a value. If the decision can be responsibly compared by bounding that uncertainty or showing scenarios, set ready=true and disclose it in the note; otherwise ask for the specific information or evidence that would resolve it.

When ready, prepare the council setup:
- title: 3 to 7 words; decision: one line.
- brief: under 220 words using the founder's facts, success target, constraints, and lean. Do not invent facts.
- options: 2 to 4 concrete choices with A-D ids. Include keeping the status quo or not doing it, and a smaller/reversible option when relevant.
- assumptions: list only bounded, non-decision-critical assumptions; never use this field to bypass an unanswered material question. Do not list facts as assumptions.
- weights: one row for every registered seat, weight 1 to 3, exactly one or two seats at weight 3, with a reason.
- recommended_seats: 5 to 7 relevant advisors, including a downside-checking seat and a likely dissenter. quick_seats: four advisors including the top-weight seats and downside checker.
- note: a short plain-language recap of any key clarification or remaining uncertainty.

If not ready, still fill the remaining required fields with a best provisional draft, but the web app will show only your questions. Never make up a founder answer.`
  });

  const ready = Boolean(raw.ready);
  const normalized = {
    ready,
    questions: ready ? [] : (raw.questions || []).slice(0, 2).map((q) => String(q).trim()).filter(Boolean),
    note: String(raw.note || ""),
    setup: null,
  };
  if (!ready) {
    if (!normalized.questions.length) throw new Error("The intake Chair returned neither a ready review nor a follow-up question. Please try again.");
    return normalized;
  }

  const ids = new Set(["A", "B", "C", "D"]);
  const options = (raw.options || []).filter((o) => ids.has(o.id) && String(o.label || "").trim()).slice(0, 4);
  const recommended = [...new Set((raw.recommended_seats || []).filter((k) => SEATS.some((x) => x.key === k)))].slice(0, 9);
  const quick = [...new Set((raw.quick_seats || []).filter((k) => SEATS.some((x) => x.key === k)))].slice(0, 4);
  if (options.length < 2 || recommended.length < 5 || recommended.length > 7 || quick.length !== 4) {
    throw new Error("The intake Chair returned an incomplete council setup. Please review the question and try again.");
  }
  normalized.setup = {
    title: String(raw.title || "Founder decision"),
    decision: String(raw.decision || ""),
    brief: String(raw.brief || ""),
    options,
    assumptions: (raw.assumptions || []).map(String),
    weights: (raw.weights || []).filter((w) => SEATS.some((x) => x.key === w.seat)),
    seats: recommended,
    quick_seats: quick,
    note: normalized.note,
  };
  return normalized;
}

export function storeIntake(input, setup) {
  const now = Date.now();
  for (const [id, entry] of intakes) if (entry.expires < now) intakes.delete(id);
  const id = randomUUID();
  intakes.set(id, { input, setup, expires: now + INTAKE_TTL });
  return id;
}

/** Consume a founder-confirmed setup exactly once, preventing direct/automatic council starts. */
export function consumeIntake(id) {
  const entry = intakes.get(String(id || ""));
  if (!entry) return null;
  intakes.delete(String(id));
  if (entry.expires < Date.now()) return null;
  return { input: entry.input, setup: entry.setup };
}
