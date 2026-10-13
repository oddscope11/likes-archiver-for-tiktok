import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecord, classify, isValidId } from "../extension/lib/record.js";

const seen = (now) => ({ now, newerCursor: "200", olderCursor: "100" });

test("classifies videos, photo posts and anything else", () => {
  assert.equal(classify({ video: { playAddr: "https://example.com/v" } }), "video");
  assert.equal(classify({ video: { playAddr: "", bitrateInfo: [{}] } }), "video");
  assert.equal(classify({ imagePost: { images: [] }, video: { playAddr: "" } }), "photo");
  assert.equal(classify({ video: { playAddr: "" } }), "unknown");
  assert.equal(classify({}), "unknown");
});

test("only numeric string ids are valid", () => {
  assert.ok(isValidId("7695951229905538318"));
  for (const id of [7695951229905538318, "", "../x", "12a", "1/2", null, undefined, "1".repeat(33)]) {
    assert.ok(!isValidId(id), String(id));
  }
});

test("a first sighting records when and where the item was seen", () => {
  const item = { id: "1", video: { playAddr: "https://example.com/v" } };
  assert.deepEqual(buildRecord(item, null, seen("2026-10-13T10:00:00.000Z")), {
    format: 1,
    id: "1",
    kind: "video",
    firstSeenAt: "2026-10-13T10:00:00.000Z",
    seenAt: ["2026-10-13T10:00:00.000Z"],
    feedWindow: { newerCursor: "200", olderCursor: "100" },
    media: null,
    raw: item
  });
});

test("a later sighting keeps history and saved media, and refreshes the raw data", () => {
  const first = buildRecord({ id: "1", desc: "old" }, null, seen("2026-10-13T10:00:00.000Z"));
  first.media = { file: "a.mp4" };

  const second = buildRecord({ id: "1", desc: "new" }, first, {
    now: "2026-10-20T10:00:00.000Z",
    newerCursor: "900",
    olderCursor: "800"
  });

  assert.equal(second.firstSeenAt, "2026-10-13T10:00:00.000Z");
  assert.deepEqual(second.seenAt, ["2026-10-13T10:00:00.000Z", "2026-10-20T10:00:00.000Z"]);
  assert.deepEqual(second.feedWindow, { newerCursor: "200", olderCursor: "100" });
  assert.deepEqual(second.media, { file: "a.mp4" });
  assert.equal(second.raw.desc, "new");
});
