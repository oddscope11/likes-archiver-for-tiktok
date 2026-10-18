import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rankStreams } from "../extension/lib/select.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/items.json", import.meta.url), "utf8"));

const gear = (name, codec, width, height, bitrate, urls = ["https://example.com/" + name]) => ({
  GearName: name,
  CodecType: codec,
  Bitrate: bitrate,
  PlayAddr: { Width: width, Height: height, DataSize: bitrate, UrlList: urls }
});
const item = (...gears) => ({ video: { bitrateInfo: gears } });
const names = (streams) => streams.map((s) => s.gearName);

test("prefers the most pixels, even at a lower bitrate", () => {
  const [best] = rankStreams(fixtures.video_hevc_1080p);
  assert.deepEqual([best.gearName, best.width, best.height], ["adapt_lowest_1080_1", 1080, 1920]);
  assert.ok(best.urls.length > 0 && best.bytes > 0);
});

test("at the same resolution, HEVC beats H.264 and then the higher bitrate wins", () => {
  const ranked = rankStreams(fixtures.video_mixed_codecs_same_resolution);
  assert.deepEqual(
    ranked.map((s) => [s.codecType, s.bitrate]),
    [
      ["h265_hvc1", 412252],
      ["h265_hvc1", 155231],
      ["h264", 614619],
      ["h264", 294971]
    ]
  );
});

test("VVC streams are never chosen", () => {
  const ranked = rankStreams(item(gear("vvc", "bytevc2", 1080, 1920, 900), gear("hevc", "bytevc1", 720, 1280, 800)));
  assert.deepEqual(names(ranked), ["hevc"]);
});

test("streams without an https address are ignored", () => {
  const ranked = rankStreams(item(gear("a", "h264", 1080, 1920, 1, []), gear("b", "h264", 720, 1280, 1, ["blob:x"]), gear("c", "h264", 540, 960, 1)));
  assert.deepEqual(names(ranked), ["c"]);
});

test("falls back to the default stream when there is no stream list", () => {
  const ranked = rankStreams({ video: { playAddr: "https://example.com/v", width: 576, height: 1024, codecType: "h264" } });
  assert.deepEqual(names(ranked), ["default"]);
  assert.deepEqual(ranked[0].urls, ["https://example.com/v"]);
});

test("photo posts, empty items and the watermarked download address give no streams", () => {
  assert.deepEqual(rankStreams(fixtures.photo_many_images), []);
  assert.deepEqual(rankStreams({}), []);
  assert.deepEqual(rankStreams({ video: { downloadAddr: "https://example.com/watermarked" } }), []);
});
