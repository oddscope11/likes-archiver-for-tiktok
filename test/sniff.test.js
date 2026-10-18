import { test } from "node:test";
import assert from "node:assert/strict";
import { sniffExtension, SNIFF_BYTES } from "../extension/lib/sniff.js";

const hex = (text) => Uint8Array.from(text.match(/../g).map((pair) => parseInt(pair, 16)));

// First bytes of real files saved from TikTok.
const MP4 = hex("0000001c6674797069736f6d00000200");
const JPEG = hex("ffd8ffe000104a464946000101000048");
const MP3_WITH_ID3 = hex("49443304000000000377545858580000");
const MP3_FRAME = hex("fffb90640000000000000000");
const PNG = hex("89504e470d0a1a0a0000000d49484452");
const WEBP = hex("524946462400000057454250565038");
const HTML = new TextEncoder().encode("<!DOCTYPE html><html>");

test("names each kind of file from its first bytes", () => {
  const head = (bytes) => bytes.subarray(0, SNIFF_BYTES);
  assert.equal(sniffExtension(head(MP4), "video"), "mp4");
  assert.equal(sniffExtension(head(JPEG), "image"), "jpg");
  assert.equal(sniffExtension(head(PNG), "image"), "png");
  assert.equal(sniffExtension(head(WEBP), "image"), "webp");
  assert.equal(sniffExtension(head(MP3_WITH_ID3), "audio"), "mp3");
  assert.equal(sniffExtension(head(MP3_FRAME), "audio"), "mp3");
  // A sound in an MP4 container.
  assert.equal(sniffExtension(head(MP4), "audio"), "m4a");
});

test("rejects content that is not the expected kind", () => {
  assert.equal(sniffExtension(HTML, "video"), null);
  assert.equal(sniffExtension(HTML, "image"), null);
  assert.equal(sniffExtension(HTML, "audio"), null);
  assert.equal(sniffExtension(JPEG, "video"), null);
  assert.equal(sniffExtension(MP4, "image"), null);
  assert.equal(sniffExtension(MP3_WITH_ID3, "video"), null);
  assert.equal(sniffExtension(new Uint8Array(0), "video"), null);
  assert.equal(sniffExtension(MP4, "other"), null);
});
