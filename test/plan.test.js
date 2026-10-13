import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planItem, safeHandle } from "../extension/lib/plan.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/items.json", import.meta.url), "utf8"));

test("a video becomes one file using the best stream", () => {
  const item = fixtures.video_hevc_1080p;
  const plan = planItem(item);
  assert.deepEqual(plan.notes, []);
  assert.equal(plan.parts.length, 1);
  const [part] = plan.parts;
  assert.equal(part.role, "video");
  assert.equal(part.stem, `creator1_${item.id}`);
  assert.equal(part.urls.length, 3);
  assert.equal(part.stream.gearName, "adapt_lowest_1080_1");
  assert.equal(part.expectedBytes, part.stream.bytes);
  assert.ok(!("urls" in part.stream), "signed addresses are not copied into the record");
});

test("a photo post becomes numbered images plus its audio", () => {
  const item = fixtures.photo_many_images;
  const plan = planItem(item);
  assert.deepEqual(plan.notes, []);
  assert.deepEqual(
    plan.parts.map((p) => p.role),
    [...Array(9).fill("image"), "audio"]
  );
  assert.equal(plan.parts[0].stem, `creator5_${item.id}_01`);
  assert.equal(plan.parts[8].stem, `creator5_${item.id}_09`);
  assert.equal(plan.parts[9].stem, `creator5_${item.id}_audio`);
});

test("a photo post without audio is saved as images and says so", () => {
  const plan = planItem(fixtures.photo_without_audio_url);
  assert.deepEqual(plan.notes, ["no_audio"]);
  assert.ok(plan.parts.length > 0 && plan.parts.every((p) => p.role === "image"));
});

test("items with nothing to save report why", () => {
  assert.deepEqual(planItem({ id: "1", video: { bitrateInfo: [{ CodecType: "bytevc2", PlayAddr: { UrlList: ["https://example.com/v"] } }] } }), { problem: "no_stream" });
  assert.deepEqual(planItem({ id: "1", imagePost: { images: [] } }), { problem: "no_images" });
  assert.deepEqual(planItem({ id: "1", imagePost: { images: [{ imageURL: { urlList: [] } }] } }), { problem: "no_images" });
  assert.deepEqual(planItem({ id: "1" }), { problem: "unknown_kind" });
});

test("creator handles are made safe for file names", () => {
  assert.equal(safeHandle("some.user_1"), "some.user_1");
  assert.equal(safeHandle("../../etc/passwd"), "etcpasswd");
  assert.equal(safeHandle("...hidden"), "hidden");
  assert.equal(safeHandle("a b\\c:d*e"), "abcde");
  assert.equal(safeHandle("x".repeat(100)).length, 40);
  for (const empty of ["", "...", null, undefined, "日本語"]) assert.equal(safeHandle(empty), "unknown");
});
