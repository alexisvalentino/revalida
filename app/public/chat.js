// "Talk to them": pick a seat and have a conversation.
//
// The page is deliberately separate from the council view. The council is a show you watch;
// this is a chat you drive. Both read the same brain: the server sends the seat's agent file
// plus its brain files as the system prompt, so the chat and the council agree on the persona.
const $ = (s) => document.querySelector(s);
const KEY = "roast-chat-v1";
const DAILY_KEY = "revalida-daily-sequence-v1";

function dailySequenceId() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(DAILY_KEY) || "{}"); } catch { /* replace a malformed local draft */ }
  if (!saved.sequenceId) saved.sequenceId = crypto.randomUUID();
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(saved)); } catch { /* the server still enforces the IP limit */ }
  return saved.sequenceId;
}

// Without this, Chrome restores the previous scroll (and focus) of the rail after a reload,
// which silently hides the first advisor and looks like the list is empty at the top.
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

const state = {
  seats: [],
  active: null,
  chats: new Map(),     // seat key -> [{ role, content }]
  streaming: false,
  meta: null,
  truncated: false,
};
let openedAt = 0;

// ---------- persistence (chat only, never the brain) ----------
function loadChats() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    for (const [k, v] of Object.entries(raw)) if (Array.isArray(v)) state.chats.set(k, v);
  } catch { /* a corrupt store just starts empty */ }
}
function saveChats() {
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(state.chats)));
  } catch { /* quota is not worth interrupting a conversation for */ }
}

// ---------- small helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Only bold is rendered: brains are quote-heavy, everything else stays literal.
const fmt = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

function avatar(seat, cls = "chat-av") {
  const src = seat.portraits?.base;
  const inner = src ? `<img src="${esc(src)}" alt="">` : esc(seat.initials || seat.short.slice(0, 2));
  return `<span class="${cls}" style="background:${esc(seat.color || "#16293a")}22">${inner}</span>`;
}

function welcome(seat) {
  return `You're talking to the ${seat.short} seat. Ask about ${seat.dimension.toLowerCase()}, or anything you would bring to a board.`;
}

function chipsFor(seat) {
  return [
    "What is the first thing you would cut here?",
    `Where would you push back hardest on a ${seat.pillar.toLowerCase()} call?`,
    "What would you need to see before you said yes?",
  ];
}

// ---------- rail ----------
function renderPeople() {
  const q = ($("#chatSearch")?.value || "").trim().toLowerCase();
  const list = state.seats.filter((s) =>
    !q || s.name.toLowerCase().includes(q) || s.short.toLowerCase().includes(q) || s.pillar.toLowerCase().includes(q));
  $("#chatPeople").innerHTML = list.map((s) => `
    <li>
      <button type="button" class="chat-person-btn" data-seat="${esc(s.key)}" aria-current="${state.active?.key === s.key}">
        ${avatar(s)}
        <span class="chat-who"><b>${esc(s.name)}</b><small>${esc(s.pillar)}</small></span>
      </button>
    </li>`).join("") || `<li class="muted" style="padding:12px">No advisor matches that.</li>`;
}

// ---------- conversation ----------
function renderThread() {
  const seat = state.active;
  if (!seat) return;
  $("#chatActive").innerHTML = `${avatar(seat)}<span class="chat-who"><b>${esc(seat.name)}</b><small>${esc(seat.pillar)}</small></span>`;

  const msgs = state.chats.get(seat.key) || [];

  if (!msgs.length) {
    $("#chatInner").innerHTML = `
      <div class="chat-empty">
        <h2>${esc(seat.name)}</h2>
        <p>${esc(welcome(seat))}</p>
        <div class="chat-chips">
          ${chipsFor(seat).map((c) => `<button type="button" class="chat-chip" data-chip="${esc(c)}">${esc(c)}</button>`).join("")}
        </div>
      </div>`;
  } else {
    $("#chatInner").innerHTML = msgs.map((m) => m.role === "user"
      ? `<div class="msg user"><div class="msg-body"><div class="msg-name">You</div><div class="msg-text">${fmt(m.content)}</div></div></div>`
      : `<div class="msg assistant">${avatar(seat)}<div class="msg-body"><div class="msg-name">${esc(seat.short)}</div><div class="msg-text">${fmt(m.content)}</div></div></div>`
    ).join("");
    scrollToEnd();
  }

  $("#chatForm").hidden = false;
  $("#chatInput").placeholder = `Ask ${seat.short} something...`;
  $("#chatNote").innerHTML = noteLine();
}

function noteLine() {
  const u = state.meta?.usage;
  const used = u
    ? `${(u.prompt + u.completion).toLocaleString()} tokens in ${u.calls} ${u.calls === 1 ? "reply" : "replies"}`
    : "no replies yet";
  return `<span>Simulated from public work. Not the person.</span><span>${esc(state.meta?.model || "")} · ${used}${state.truncated ? " · cut at the length cap" : ""}</span>`;
}

function scrollToEnd() {
  const el = $("#chatScroll");
  if (!el) return;
  // Two frames: the second one runs after fonts and avatars have changed the height.
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  });
}

function appendMessage(role, content) {
  const seat = state.active;
  if (!seat) return;
  const list = state.chats.get(seat.key) || [];
  list.push({ role, content });
  state.chats.set(seat.key, list);
  saveChats();
  renderThread();
}

function showTyping(on) {
  const el = $("#chatTyping");
  el.hidden = !on;
  if (on) $("#chatScroll").scrollTop = $("#chatScroll").scrollHeight;
}

function showError(msg) {
  const el = $("#chatError");
  if (!msg) { el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = msg;
}

// ---------- send ----------
async function send(text) {
  const seat = state.active;
  const msg = String(text || "").trim();
  if (!seat || !msg || state.streaming) return;

  showError("");
  state.truncated = false;
  appendMessage("user", msg);
  $("#chatInput").value = "";
  autoGrow($("#chatInput"));

  state.streaming = true;
  $("#chatSend").disabled = true;
  showTyping(true);

  const history = (state.chats.get(seat.key) || []).slice(-16);
  let answer = "";
  let bubble = null;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat: seat.key, messages: history, sequenceId: dailySequenceId() }),
    });

    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || `Request failed (${res.status})`);
    }

    // Stream: create the bubble on the first token so the reply grows in place.
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
        if (ev.sequenceId) {
          try {
            const saved = JSON.parse(localStorage.getItem(DAILY_KEY) || "{}");
            saved.sequenceId = ev.sequenceId;
            localStorage.setItem(DAILY_KEY, JSON.stringify(saved));
          } catch { /* the request token is already held for this request */ }
        }
        if (ev.error) throw new Error(ev.error);
        if (ev.t) {
          if (!bubble) { showTyping(false); bubble = document.createElement("div"); bubble.className = "msg assistant"; $("#chatInner").appendChild(bubble); }
          answer += ev.t;
          bubble.innerHTML = `${avatar(seat)}<div class="msg-body"><div class="msg-name">${esc(seat.short)}</div><div class="msg-text">${fmt(answer)}</div></div>`;
          $("#chatScroll").scrollTop = $("#chatScroll").scrollHeight;
        }
        if (ev.done) {
          if (ev.usage) state.meta = { ...state.meta, usage: ev.usage };
          state.truncated = Boolean(ev.truncated);
        }
      }
    }

    if (!answer.trim()) throw new Error("The seat returned nothing. Try again, or check the room's terminal.");
    appendMessage("assistant", answer);
    refreshMeta();
  } catch (e) {
    showError(String(e.message || e));
    // Leave the user's message in place so they can retry without retyping.
    if (bubble) bubble.remove();
    renderThread();
  } finally {
    state.streaming = false;
    $("#chatSend").disabled = false;
    showTyping(false);
  }
}

// ---------- helpers ----------
function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 180) + "px";
}

async function refreshMeta() {
  try {
    const r = await fetch("/api/seats");
    const j = await r.json();
    state.meta = { model: j.chat?.model, usage: j.chat?.usage, ready: j.chat?.ready };
    if (!j.chat?.ready) showError("No OPENAI_API_KEY on the server. Add one to .env to talk to the seats.");
    // Repaint the footer so the token count moves with the reply, not the next message.
    const note = $("#chatNote");
    if (note) note.innerHTML = noteLine();
  } catch { /* the room already reports its own errors */ }
}

function selectSeat(key) {
  const seat = state.seats.find((s) => s.key === key);
  if (!seat) return;
  state.active = seat;
  showError("");
  renderPeople();
  renderThread();
  $("#chatInput").focus();
}

// ---------- boot ----------
async function boot() {
  loadChats();
  try {
    const r = await fetch("/api/seats");
    const j = await r.json();
    state.seats = j.seats || [];
    state.meta = { model: j.chat?.model, usage: j.chat?.usage };
    if (!j.chat?.ready) showError("No OPENAI_API_KEY on the server. Add one to .env to talk to the seats.");
  } catch {
    state.seats = [];
    showError("Could not reach the room server.");
  }
  renderPeople();
  if (!state.active && state.seats.length) selectSeat(state.seats[0].key);
}

function open() {
  $("#chatPage").hidden = false;
  openedAt = Date.now();
  document.body.style.overflow = "hidden";
  if (!state.seats.length) boot();
  else { renderPeople(); renderThread(); }
  const rail = $("#chatPeople");
  if (rail) rail.scrollTop = 0;
  setTimeout(() => $("#chatInput")?.focus(), 40);
}
function close() {
  // A double-click on "Talk to them" used to close the page it had just opened,
  // because the second click lands where the back button sits.
  if (Date.now() - openedAt < 350) return;
  $("#chatPage").hidden = true;
  document.body.style.overflow = "";
}

// ---------- wiring ----------
$("#chatBtn")?.addEventListener("click", open);
$("#chatClose")?.addEventListener("click", close);
$("#chatClear")?.addEventListener("click", () => {
  if (!state.active) return;
  state.chats.set(state.active.key, []);
  saveChats();
  renderThread();
});
$("#chatSearch")?.addEventListener("input", renderPeople);
$("#chatPeople")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-seat]");
  if (b) selectSeat(b.dataset.seat);
});
$("#chatInner")?.addEventListener("click", (e) => {
  const c = e.target.closest("[data-chip]");
  if (c) send(c.dataset.chip);
});
$("#chatForm")?.addEventListener("submit", (e) => {
  e.preventDefault();
  send($("#chatInput").value);
});
$("#chatInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#chatForm").requestSubmit(); }
});
$("#chatInput")?.addEventListener("input", (e) => autoGrow(e.target));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#chatPage").hidden) close();
});
