import { test } from "node:test";
import assert from "node:assert/strict";
import { firstDownloadState, planWalks, retryCursors, nextCooldown, isCoolingDown } from "../extension/lib/progress.js";

test("a new archive starts its first download from the top", () => {
  const state = firstDownloadState({});
  assert.deepEqual(state, { complete: false, nextCursor: null });
  assert.deepEqual(planWalks(state), [{ kind: "first", from: "0" }]);
});

test("an interrupted first download checks for new likes, then continues where it stopped", () => {
  assert.deepEqual(planWalks({ complete: false, nextCursor: "1744715233000" }), [
    { kind: "updates", from: "0" },
    { kind: "first", from: "1744715233000" }
  ]);
});

test("once the first download is complete, runs only look for new likes", () => {
  assert.deepEqual(planWalks({ complete: true, nextCursor: null }), [{ kind: "updates", from: "0" }]);
});

test("failed items are retried one page each, skipping pages already visited", () => {
  const failures = { a: "300", b: "300", c: "200", d: "100", e: "50" };
  assert.deepEqual(retryCursors(failures, new Set(["c"]), 5), ["300", "100", "50"]);
  assert.deepEqual(retryCursors(failures, new Set(), 2), ["300", "200"]);
  assert.deepEqual(retryCursors(undefined, new Set(), 5), []);
});

test("cooldowns double with each pushback on the same day, up to eight hours", () => {
  const HOUR = 3600_000;
  const morning = new Date(2026, 9, 14, 9, 0).getTime();
  const first = nextCooldown(null, morning);
  assert.equal(first.until - morning, HOUR);
  const second = nextCooldown(first, morning + 2 * HOUR);
  assert.equal(second.until - (morning + 2 * HOUR), 2 * HOUR);
  let c = second;
  for (let i = 0; i < 5; i++) c = nextCooldown(c, morning + 3 * HOUR);
  assert.equal(c.until - (morning + 3 * HOUR), 8 * HOUR);
});

test("a new day starts the cooldown over at one hour", () => {
  const day1 = new Date(2026, 9, 14, 20, 0).getTime();
  const day2 = new Date(2026, 9, 15, 9, 0).getTime();
  const strong = { day: new Date(day1).toDateString(), strikes: 4, until: day1 };
  assert.equal(nextCooldown(strong, day2).until - day2, 3600_000);
});

test("cooling down until the stated time", () => {
  assert.ok(isCoolingDown({ until: 2000 }, 1000));
  assert.ok(!isCoolingDown({ until: 2000 }, 2000));
  assert.ok(!isCoolingDown(null, 1000));
});
