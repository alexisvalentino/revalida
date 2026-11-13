import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { isIP } from "node:net";
import { APP_ROOT, env } from "./lib/env.mjs";
import { loadRoster, BOARD, systemFor, byKey, SEATS } from "./lib/seats.mjs";
import { startCouncil, getSession, subscribe, listSaved, loadSaved, MODELS } from "./lib/council.mjs";
import { chatStream, hasChatKey, chatUsage, councilUsage, CHAT_MODEL } from "./lib/openai.mjs";
import { reviewCouncilInput, storeIntake, consumeIntake } from "./lib/intake.mjs";
import { createDailyLimitStore } from "./lib/daily-limit.mjs";
import * as watch from "./lib/watch.mjs";

const PORT = Number(process.env.PORT) || 4730;
const PUBLIC = path.join(APP_ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".json": "application/json", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8" };

let running = null; // one council at a time (API runner)

// The web app runs councils directly through OpenAI by default. Set "viewer" only
// when this instance should replay councils started externally.
const RUNNER = (process.env.COUNCIL_RUNNER || env("COUNCIL_RUNNER") || "api").toLowerCase() === "viewer" ? "viewer" : "api";
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || env("TRUST_PROXY"));
const dailyLimit = createDailyLimitStore({
  filePath: process.env.DAILY_LIMIT_FILE || path.join(APP_ROOT, ".daily-limit.json"),
  secret: process.env.DAILY_LIMIT_SECRET || env("DAILY_LIMIT_SECRET") || process.env.OPENAI_API_KEY || env("OPENAI_API_KEY") || "revalida-local-limit",
});
watch.startWatching();

function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function clientIp(req) {
  // Only trust X-Real-IP when a controlled reverse proxy overwrites that header.
  const forwarded = TRUST_PROXY ? req.headers["x-real-ip"] : "";
  let ip = typeof forwarded === "string" ? forwarded.trim() : "";
  if (!isIP(ip)) ip = String(req.socket.remoteAddress || "unknown").trim();
  if (ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  return isIP(ip) ? ip.toLowerCase() : "unknown";
}

function dailyLimitError(res, result) {
  return send(res, 429, {
    error: "This network has already used its Revalida AI sequence for today. Resume it on the browser that started it, or try again after 00:00 UTC.",
    resetAt: result.resetAt,
    state: result.state,
  });
}

async function readJson(req) {
  let raw = "";
  for await (const c of req) { raw += c; if (raw.length > 1e5) throw new Error("body too large"); }
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === "/api/sequence" && req.method === "GET") {
      const status = dailyLimit.inspect(clientIp(req), req.headers["x-revalida-sequence"]);
      const session = status.sessionId ? getSession(status.sessionId) || loadSaved(status.sessionId) : null;
      return send(res, 200, {
        ...status,
        running: session?.status === "running",
        completed: status.state === "started" && session?.status !== "running",
      });
    }
    if (p === "/api/seats") {
      // portraits: which of the four mouth shapes exist for each seat (a seat with none gets a drawn bust)
      const frame = (key, sh) => ["webp", "png", "jpg"].map((x) => `${key}-${sh}.${x}`).find((f) => fs.existsSync(path.join(PUBLIC, "portraits", f)));
      const seats = loadRoster().map((s) => ({ ...s, portraits: Object.fromEntries(["base", "open", "mid", "blink"].map((sh) => [sh, frame(s.key, sh)]).filter(([, f]) => f).map(([sh, f]) => [sh, `/portraits/${f}`])) }));
      return send(res, 200, { seats, board: BOARD, models: MODELS, runner: RUNNER, hasKey: hasChatKey(), chat: { ready: hasChatKey(), model: CHAT_MODEL, usage: chatUsage } });
    }
    if (p === "/api/usage") return send(res, 200, councilUsage);
    // "Talk to them": one seat, one conversation, streamed back as it is written.
    if (p === "/api/chat" && req.method === "POST") {
      const body = await readJson(req);
      loadRoster();
      const seat = byKey[String(body.seat || "")];
      if (!seat) return send(res, 404, { error: "no such seat" });
      if (!hasChatKey()) return send(res, 503, { error: "No OPENAI_API_KEY. Add one to .env to talk to the seats." });
      // Keep a short, bounded history: long chats cost money and the seat's brain is fixed anyway.
      const history = (Array.isArray(body.messages) ? body.messages : [])
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-16)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      if (!history.length || history[history.length - 1].role !== "user") return send(res, 400, { error: "Send a message first." });
      const sequence = dailyLimit.reserve(clientIp(req), body.sequenceId);
      if (!sequence.allowed || sequence.state === "started") return dailyLimitError(res, sequence);

      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(": connected\n\n");
      res.write(`data: ${JSON.stringify({ sequenceId: sequence.sequenceId })}\n\n`);
      let closed = false;
      res.on("close", () => { closed = true; });
      try {
        const result = await chatStream({
          // A chat is not a council round: no seat headers, no scores, and short enough
          // to finish inside the output budget instead of being cut off mid-sentence.
          system:
            systemFor(seat.key)[0].text +
            "\n\n## Chat mode\nYou are in a one to one chat, not a council round. Talk as yourself, in your own voice. No SEAT headers, no option scores, no round format. Keep answers under about 250 words unless the person asks you to go deeper. Use the market pack when the question turns on market or funding numbers, and cite it the way the pack says.",
          messages: history,
          onText: (t) => { if (!closed) res.write(`data: ${JSON.stringify({ t })}\n\n`); },
        });
        if (!closed) res.write(`data: ${JSON.stringify({ done: true, usage: chatUsage, truncated: Boolean(result && result.truncated) })}\n\n`);
      } catch (e) {
        if (!closed) res.write(`data: ${JSON.stringify({ error: String(e.message || e) })}\n\n`);
      }
      if (!closed) res.end();
      return;
    }
    if (p === "/api/intake" && req.method === "POST") {
      if (!hasChatKey()) return send(res, 503, { error: "No OPENAI_API_KEY found. Add it to .env and restart the server." });
      const { input, answers, sequenceId } = await readJson(req);
      if (typeof input !== "string" || input.trim().length < 10) return send(res, 400, { error: "Describe the decision before asking the Chair to review it." });
      if (input.length > 8000) return send(res, 400, { error: "Keep the decision brief under 8,000 characters." });
      if (running && getSession(running)?.status === "running") return send(res, 409, { error: "A council is already in session. Rejoin it before starting another review." });
      const sequence = dailyLimit.reserve(clientIp(req), sequenceId);
      if (!sequence.allowed || sequence.state === "started") return dailyLimitError(res, sequence);
      const followups = Array.isArray(answers) ? answers.slice(0, 12).map((x) => ({
        question: String(x?.question || "").slice(0, 500),
        answer: String(x?.answer || "").slice(0, 2000),
      })).filter((x) => x.question && x.answer) : [];
      const review = await reviewCouncilInput({ input: input.trim(), answers: followups });
      const intakeId = review.ready ? storeIntake(input.trim(), review.setup) : null;
      return send(res, 200, { intakeId, review, sequenceId: sequence.sequenceId });
    }
    if (p === "/api/council" && req.method === "POST") {
      if (RUNNER !== "api") return send(res, 403, { error: "This room is set to viewer mode. Set COUNCIL_RUNNER=api in .env and restart the server to run councils here." });
      if (!hasChatKey()) return send(res, 503, { error: "No OPENAI_API_KEY found. Add it to .env and restart the server." });
      const { intakeId, mode, seats, sequenceId } = await readJson(req);
      const ip = clientIp(req);
      const sequence = dailyLimit.inspect(ip, sequenceId);
      if (!sequence.allowed) return dailyLimitError(res, sequence);
      if (sequence.state === "started") {
        if (sequence.sessionId && getSession(sequence.sessionId)?.status === "running") return send(res, 200, { id: sequence.sessionId, resumed: true });
        return dailyLimitError(res, sequence);
      }
      if (running && getSession(running)?.status === "running") return send(res, 409, { error: "A council is already in session. Wait for its verdict." });
      if (!intakeId) return send(res, 409, { error: "Review the decision with the Chair and confirm the advisor board before starting." });
      loadRoster();
      const selectedSeats = Array.isArray(seats) ? [...new Set(seats.map(String))].filter((key) => byKey[key]).slice(0, 9) : [];
      if (selectedSeats.length < 3 || (Array.isArray(seats) && seats.length > 9)) return send(res, 400, { error: "Confirm a board of 3–9 valid advisors before starting." });
      if (mode === "quick" && selectedSeats.length !== 4) return send(res, 400, { error: "A quick council needs exactly four advisors." });
      if (!sequenceId) return send(res, 409, { error: "Start or resume today's Revalida sequence before starting the council." });
      const approved = consumeIntake(intakeId);
      if (!approved) return send(res, 409, { error: "This review expired or was already used. Review the decision again before starting." });
      const allowance = sequence.state === "none" ? dailyLimit.reserve(ip, sequenceId) : sequence;
      if (!allowance.allowed || allowance.state !== "active") return dailyLimitError(res, allowance);
      const s = startCouncil(approved.input, mode === "quick" ? "quick" : "full", selectedSeats, approved.setup);
      running = s.id;
      if (!dailyLimit.markStarted(ip, sequenceId, s.id)) return send(res, 409, { error: "This daily sequence could not be confirmed. Resume your current council or try again tomorrow." });
      return send(res, 200, { id: s.id });
    }
    if (p.startsWith("/api/stream/")) {
      const id = decodeURIComponent(p.split("/").pop());
      const s = getSession(id) || watch.getLive(id);
      if (!s) return send(res, 404, { error: "no such session" });
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(": connected\n\n");
      const ping = setInterval(() => res.write(": ping\n\n"), 15000);
      res.on("close", () => clearInterval(ping));
      return subscribe(s, res);
    }
    if (p === "/api/sessions") {
      const external = watch.listLive().filter((session) => RUNNER === "viewer" || session.status !== "running");
      const all = [...listSaved(), ...external].sort((a, b) => (a.id < b.id ? 1 : -1));
      const sequence = dailyLimit.inspect(clientIp(req), req.headers["x-revalida-sequence"]);
      const apiRunning = sequence.allowed && sequence.sessionId === running && running && getSession(running)?.status === "running" ? running : null;
      return send(res, 200, { sessions: all, running: apiRunning, live: RUNNER === "viewer" ? watch.runningId() : null });
    }
    if (p.startsWith("/api/sessions/")) {
      const id = decodeURIComponent(p.split("/").pop());
      const x = watch.getLive(id);
      const j = loadSaved(id) || (x && { id, title: x.title, mode: x.mode, status: x.status, events: x.events });
      return j ? send(res, 200, j) : send(res, 404, { error: "not found" });
    }
    // static
    const file = path.normalize(path.join(PUBLIC, p === "/" ? "index.html" : p));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, "Not found", "text/plain");
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Revalida on http://localhost:${PORT} (${RUNNER === "api" ? "web council runner: OpenAI" : "viewer mode"})`));
