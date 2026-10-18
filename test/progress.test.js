import { test } from "node:test";
import assert from "node:assert/strict";
import { firstDownloadState, planWalks, topCheckedAt, isNew, retryCursors, nextCooldown } from "../extension/lib/progress.js";

test("a run starts, continues or only updates the first download", () => {
  // A new archive starts its first download from the top.
  assert.deepEqual(planWalks(firstDownloadState({})), [{ kind: "first", from: "0" }]);
  // An interrupted one checks for new likes, then continues where it stopped.
  assert.deepEqual(planWalks({ complete: false, nextCursor: "1744715233000" }), [
    { kind: "updates", from: "0" },
    { kind: "first", from: "1744715233000" }
  ]);
  // A complete one only looks for new likes.
  assert.deepEqual(planWalks({ complete: true, nextCursor: null }), [{ kind: "updates", from: "0" }]);
});

test("failed items are retried one page each, skipping pages already visited", () => {
  const failures = { a: "300", b: "300", c: "200", d: "100", e: "50" };
  assert.deepEqual(retryCursors(failures, new Set(["c"]), 5), ["300", "100", "50"]);
  assert.deepEqual(retryCursors(failures, new Set(), 2), ["300", "200"]);
  assert.deepEqual(retryCursors(undefined, new Set(), 5), []);
});

test("the suggested wait doubles with each pushback on the same day, up to eight hours", () => {
  const HOUR = 3600_000;
  const morning = new Date(2026, 9, 14, 9, 0).getTime();
  const first = nextCooldown(null, morning);
  assert.equal(first.until - morning, HOUR);
  const second = nextCooldown(first, morning + 2 * HOUR);
  assert.equal(second.until - (morning + 2 * HOUR), 2 * HOUR);
  let c = second;
  for (let i = 0; i < 5; i++) c = nextCooldown(c, morning + 3 * HOUR);
  assert.equal(c.until - (morning + 3 * HOUR), 8 * HOUR);
  // A new day starts over at one hour.
  const nextDay = new Date(2026, 9, 15, 9, 0).getTime();
  assert.equal(nextCooldown(c, nextDay).until - nextDay, HOUR);
});

test("items first seen by an interrupted walk still count as new", () => {
  const checkedAt = "2026-10-14T10:00:00.000Z";
  assert.ok(isNew(null, checkedAt));
  assert.ok(!isNew({ firstSeenAt: "2026-10-13T10:00:00.000Z" }, checkedAt));
  assert.ok(!isNew({ firstSeenAt: checkedAt }, checkedAt));
  assert.ok(isNew({ firstSeenAt: "2026-10-14T11:00:00.000Z" }, checkedAt));
  assert.ok(!isNew({ firstSeenAt: "2026-10-14T11:00:00.000Z" }, null));
});

test("the last complete check falls back to when the first download finished", () => {
  assert.equal(topCheckedAt({ topCheckedAt: "b", firstDownload: { completedAt: "a" } }), "b");
  assert.equal(topCheckedAt({ firstDownload: { completedAt: "a" } }), "a");
  assert.equal(topCheckedAt({}), null);
});
