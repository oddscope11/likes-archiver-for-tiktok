import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRecord, classify, isSaved, missingFiles, isValidId, needsSoundLookup } from "../extension/lib/record.js";

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

test("an item is saved only if its record says so and every file is present", () => {
  const present = new Set(["Likes/a.jpg", "Likes/b.jpg"]);
  const exists = (file) => present.has(file);
  const saved = (...files) => ({ media: { status: "saved", files: files.map((file) => ({ file })) } });

  assert.ok(isSaved(saved("Likes/a.jpg", "Likes/b.jpg"), exists));
  assert.ok(!isSaved(saved("Likes/a.jpg", "Likes/missing.jpg"), exists));
  assert.ok(!isSaved({ media: null }, exists));
  assert.ok(!isSaved({ media: { status: "failed", reason: "http" } }, exists));
});

test("a photo post saved without sound is unfinished until its own page was checked", () => {
  assert.ok(needsSoundLookup("photo", ["no_audio"]));
  assert.ok(!needsSoundLookup("photo", ["no_audio", "no_audio_in_details"]));
  assert.ok(!needsSoundLookup("photo", []));
  assert.ok(!needsSoundLookup("video", ["no_audio"]));
  const photo = { kind: "photo", feedWindow: { newerCursor: "7" }, media: { status: "saved", files: [], notes: ["no_audio"] } };
  assert.ok(!isSaved(photo, () => true));
  assert.equal(missingFiles(photo, () => true), "7");
});

test("fields added by other tools survive a later sighting", () => {
  const imported = { format: 1, id: "1", kind: "video", feedWindow: null, seenAt: ["2025-06-22T00:00:00.000Z"], media: null, raw: null, legacy: { source: "v1" } };
  const record = buildRecord({ id: "1", video: { playAddr: "https://example.com/v" } }, imported, seen("2026-10-20T10:00:00.000Z"));
  assert.deepEqual(record.legacy, { source: "v1" });
  assert.deepEqual(record.feedWindow, { newerCursor: "200", olderCursor: "100" });
  assert.equal(record.raw.id, "1");
});

test("saved items whose files went missing are fetched again through their page", () => {
  const record = { media: { status: "saved", files: [{ file: "Likes/a.mp4" }] }, feedWindow: { newerCursor: "123", olderCursor: "100" } };
  assert.equal(missingFiles(record, () => true), undefined);
  assert.equal(missingFiles(record, () => false), "123");
  assert.equal(missingFiles({ ...record, feedWindow: null }, () => false), null);
  assert.equal(missingFiles({ media: { status: "failed" } }, () => false), undefined);
  assert.equal(missingFiles({ media: null, feedWindow: { newerCursor: "7" } }, () => false), "7");
});
