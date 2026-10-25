import { test } from "node:test";
import assert from "node:assert/strict";
import { firstDownloadState, planWalks, isGone, lastFullCheckAt, topCheckedAt, isNew, retryCursors, nextCooldown } from "../extension/lib/progress.js";

test("a run starts, continues or only updates the first download", () => {
  // A new archive starts its first download from the top.
  assert.deepEqual(planWalks({}), [{ kind: "first", from: "0" }]);
  // An interrupted one checks for new likes, then continues where it stopped.
  assert.deepEqual(planWalks({ firstDownload: { complete: false, nextCursor: "1744715233000" } }), [
    { kind: "updates", from: "0" },
    { kind: "first", from: "1744715233000" }
  ]);
  // A complete one only looks for new likes.
  assert.deepEqual(planWalks({ firstDownload: { complete: true, nextCursor: null } }), [{ kind: "updates", from: "0" }]);
});

test("a full check walks the whole feed, and an interrupted one waits until asked for", () => {
  const done = { firstDownload: { complete: true, nextCursor: null } };
  assert.deepEqual(planWalks(done, { full: true }), [{ kind: "full", from: "0" }]);
  const paused = { ...done, fullCheck: { startedAt: "t", nextCursor: "500" } };
  assert.deepEqual(planWalks(paused), [{ kind: "updates", from: "0" }]);
  assert.deepEqual(planWalks(paused, { full: true }), [
    { kind: "updates", from: "0" },
    { kind: "full", from: "500" }
  ]);
  // The first download comes first; it already walks the whole feed.
  assert.deepEqual(planWalks({}, { full: true }), [{ kind: "first", from: "0" }]);
});

test("items a completed full check did not see are no longer in the likes", () => {
  const check = "2026-10-20T10:00:00.000Z";
  assert.ok(!isGone({ seenAt: ["2026-10-01T00:00:00.000Z"] }, null));
  assert.ok(isGone({ seenAt: ["2026-10-01T00:00:00.000Z"] }, check));
  assert.ok(!isGone({ seenAt: ["2026-10-01T00:00:00.000Z", "2026-10-20T10:05:00.000Z"] }, check));
  assert.ok(!isGone({ seenAt: [check] }, check));
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

test("the last full walk is a full check, or else the first download", () => {
  const archive = { createdAt: "a", firstDownload: { complete: true, startedAt: "b" } };
  assert.equal(lastFullCheckAt(archive), "b");
  assert.equal(lastFullCheckAt({ ...archive, lastFullCheckAt: "c" }), "c");
  assert.equal(lastFullCheckAt({ createdAt: "a", firstDownload: { complete: true } }), "a");
  assert.equal(lastFullCheckAt({ createdAt: "a", firstDownload: { complete: false, startedAt: "b" } }), null);
});
