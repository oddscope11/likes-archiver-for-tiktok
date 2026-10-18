import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry, retryDelay } from "../extension/lib/retry.js";

function harness(outcomes, delayFor) {
  const waits = [];
  let calls = 0;
  const action = async () => {
    const outcome = outcomes[calls++];
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return { waits, calls: () => calls, run: (attempts = 3) => withRetry(action, { attempts, delayFor, wait: async (ms) => waits.push(ms) }) };
}

test("retries with the delay chosen for each failure, and not after a success", async () => {
  const h = harness([new Error("a"), new Error("b"), "ok"], (err, attempt) => attempt * 100);
  assert.equal(await h.run(), "ok");
  assert.deepEqual(h.waits, [100, 200]);
  const quick = harness(["ok"], () => 10);
  assert.equal(await quick.run(), "ok");
  assert.deepEqual(quick.waits, []);
});

test("gives up after the allowed attempts", async () => {
  const h = harness([new Error("a"), new Error("b"), new Error("c"), "never"], () => 1);
  await assert.rejects(h.run(), /c/);
  assert.equal(h.calls(), 3);
});

test("does not retry errors the caller marks as final", async () => {
  const h = harness([new Error("final"), "never"], () => null);
  await assert.rejects(h.run(), /final/);
  assert.equal(h.calls(), 1);
});

test("feed requests retry network and server errors and rate limits, and one TikTok error", () => {
  const error = (name, code, detail = "") => Object.assign(new Error(code), { name, code, detail });
  assert.equal(retryDelay(error("TikTokError", "network"), 2), 14_000);
  assert.equal(retryDelay(error("TikTokError", "http", "503"), 1), 7_000);
  assert.equal(retryDelay(error("TikTokError", "rate_limited"), 1), 60_000);
  assert.equal(retryDelay(error("FeedError", "tiktok_error"), 1), 30_000);
  assert.equal(retryDelay(error("FeedError", "tiktok_error"), 2), null);
  // Never past a verification, a refusal or a client error.
  assert.equal(retryDelay(error("FeedError", "verification"), 1), null);
  assert.equal(retryDelay(error("TikTokError", "refused"), 1), null);
  assert.equal(retryDelay(error("TikTokError", "http", "403"), 1), null);
  assert.equal(retryDelay(new Error("other"), 1), null);
});
