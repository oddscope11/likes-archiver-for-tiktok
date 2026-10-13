import { test } from "node:test";
import assert from "node:assert/strict";
import { withRetry } from "../extension/lib/retry.js";

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

test("returns the first success without waiting", async () => {
  const h = harness(["ok"], () => 10);
  assert.equal(await h.run(), "ok");
  assert.deepEqual(h.waits, []);
});

test("retries with the delay chosen for each failure", async () => {
  const h = harness([new Error("a"), new Error("b"), "ok"], (err, attempt) => attempt * 100);
  assert.equal(await h.run(), "ok");
  assert.deepEqual(h.waits, [100, 200]);
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
