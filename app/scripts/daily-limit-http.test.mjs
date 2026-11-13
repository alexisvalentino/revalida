import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { test } from "node:test";
import { createDailyLimitStore } from "../lib/daily-limit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function availablePort() {
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(child, url) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error("Test server exited before it became ready.");
    try { return await fetch(url); } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  throw new Error("Test server did not become ready.");
}

test("HTTP routes reject another daily token and block new AI calls after the council starts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "revalida-limit-http-"));
  const filePath = path.join(dir, "daily.json");
  const secret = "integration-test-secret";
  const sequenceId = "5af1f08e-e977-4dd8-b9c0-00b567bc2932";
  const store = createDailyLimitStore({ filePath, secret });
  store.reserve("127.0.0.1", sequenceId);

  let child;
  try {
    const port = await availablePort();
    const origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(ROOT, "app/server.mjs")], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(port), OPENAI_API_KEY: "test-openai-key", DAILY_LIMIT_SECRET: secret, DAILY_LIMIT_FILE: filePath, TRUST_PROXY: "false" },
      stdio: "ignore",
    });
    await waitForServer(child, `${origin}/api/seats`);

    const current = await fetch(`${origin}/api/sequence`, { headers: { "x-revalida-sequence": sequenceId } }).then((r) => r.json());
    assert.equal(current.allowed, true);
    assert.equal(current.state, "active");

    const otherDevice = await fetch(`${origin}/api/sequence`).then((r) => r.json());
    assert.equal(otherDevice.allowed, false);

    const rejectedIntake = await fetch(`${origin}/api/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "Should I hire a sales lead?", sequenceId: "7a7f7b4a-603a-4f4d-8560-21323132cb57" }),
    });
    assert.equal(rejectedIntake.status, 429);

    store.markStarted("127.0.0.1", sequenceId, "resume-session");
    const rejectedChat = await fetch(`${origin}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seat: "hormozi", sequenceId, messages: [{ role: "user", content: "What is your view?" }] }),
    });
    assert.equal(rejectedChat.status, 429);

    const rejectedCouncil = await fetch(`${origin}/api/council`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intakeId: "expired-intake", mode: "full", seats: ["hormozi", "graham", "buffett"], sequenceId }),
    });
    assert.equal(rejectedCouncil.status, 429);
  } finally {
    if (child && child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
