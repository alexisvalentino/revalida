import { createHmac, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** One daily sequence per client IP. Only a keyed digest of the address is written to disk. */
export function createDailyLimitStore({ filePath, secret, now = Date.now }) {
  if (!filePath || !secret) throw new Error("Daily limit storage requires a file path and secret.");

  const digestIp = (ip) => createHmac("sha256", secret).update(String(ip || "unknown").trim().toLowerCase()).digest("hex");
  const currentDay = () => new Date(now()).toISOString().slice(0, 10);
  const nextReset = () => {
    const date = new Date(`${currentDay()}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.getTime();
  };
  const read = () => {
    if (!fs.existsSync(filePath)) return { days: {} };
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return data && typeof data.days === "object" ? data : { days: {} };
  };
  const write = (data) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temp, filePath);
  };
  const prune = (data, day) => {
    for (const savedDay of Object.keys(data.days)) if (savedDay < day) delete data.days[savedDay];
    data.days[day] ||= {};
  };
  const result = (allowed, record, day) => ({
    allowed,
    state: record?.state || "none",
    ...(allowed && record ? { sequenceId: record.sequenceId } : {}),
    ...(record?.sessionId ? { sessionId: record.sessionId } : {}),
    resetAt: Date.parse(`${day}T00:00:00.000Z`) + 24 * 60 * 60 * 1000,
  });

  function inspect(ip, sequenceId) {
    const data = read();
    const day = currentDay();
    const expired = Object.keys(data.days || {}).some((savedDay) => savedDay < day);
    if (expired) { prune(data, day); write(data); }
    const record = data.days?.[day]?.[digestIp(ip)];
    if (!record) return result(true, null, day);
    return result(record.sequenceId === sequenceId, record, day);
  }

  function reserve(ip, requestedId) {
    const data = read();
    const day = currentDay();
    prune(data, day);
    const key = digestIp(ip);
    const existing = data.days[day][key];
    if (existing) return result(existing.sequenceId === requestedId, existing, day);

    const record = {
      sequenceId: UUID.test(String(requestedId || "")) ? String(requestedId).toLowerCase() : randomUUID(),
      state: "active",
      createdAt: now(),
    };
    data.days[day][key] = record;
    write(data);
    return result(true, record, day);
  }

  function markStarted(ip, sequenceId, sessionId) {
    const data = read();
    const day = currentDay();
    const record = data.days?.[day]?.[digestIp(ip)];
    if (!record || record.sequenceId !== sequenceId || record.state !== "active") return false;
    record.state = "started";
    record.sessionId = String(sessionId);
    record.startedAt = now();
    write(data);
    return true;
  }

  return { inspect, reserve, markStarted };
}
