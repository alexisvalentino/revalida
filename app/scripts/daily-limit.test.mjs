import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDailyLimitStore } from "../lib/daily-limit.mjs";

test("one public IP gets one persistent sequence per UTC day, while its own token can resume", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "revalida-limit-"));
  const filePath = path.join(dir, "daily.json");
  let now = Date.UTC(2026, 10, 12, 16);
  try {
    const firstStore = createDailyLimitStore({ filePath, secret: "test-secret", now: () => now });
    const first = firstStore.reserve("203.0.113.7");
    assert.equal(first.allowed, true);
    assert.equal(first.state, "active");
    assert.match(first.sequenceId, /^[0-9a-f-]{36}$/i);

    const restartedStore = createDailyLimitStore({ filePath, secret: "test-secret", now: () => now });
    assert.equal(restartedStore.inspect("203.0.113.7", first.sequenceId).allowed, true);
    const blocked = restartedStore.reserve("203.0.113.7", "5af1f08e-e977-4dd8-b9c0-00b567bc2932");
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.resetAt, Date.UTC(2026, 10, 13));

    const otherIp = restartedStore.reserve("203.0.113.8");
    assert.equal(otherIp.allowed, true);
    assert.equal(restartedStore.markStarted("203.0.113.7", first.sequenceId, "council-123"), true);
    assert.equal(restartedStore.reserve("203.0.113.7", first.sequenceId).state, "started");
    assert.equal(restartedStore.markStarted("203.0.113.7", first.sequenceId, "council-456"), false);

    now = Date.UTC(2026, 10, 13, 0, 0, 0);
    assert.equal(restartedStore.reserve("203.0.113.7").allowed, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the store persists only keyed IP digests, not raw addresses", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "revalida-limit-"));
  const filePath = path.join(dir, "daily.json");
  try {
    const store = createDailyLimitStore({ filePath, secret: "test-secret", now: () => Date.UTC(2026, 10, 12) });
    store.reserve("198.51.100.42");
    const saved = fs.readFileSync(filePath, "utf8");
    assert.equal(saved.includes("198.51.100.42"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
