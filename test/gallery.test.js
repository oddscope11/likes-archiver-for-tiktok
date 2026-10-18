import { test } from "node:test";
import assert from "node:assert/strict";
import { galleryEntry, galleryData, galleryScript, parseGalleryScript, inlineGalleryPage } from "../extension/lib/gallery.js";

const fromFeed = (id, olderCursor, extra = {}) => ({
  id,
  kind: "video",
  feedWindow: { newerCursor: "0", olderCursor },
  raw: { id, desc: `caption ${id}`, createTime: 1700000000, author: { uniqueId: "maker", nickname: "Maker" }, video: { duration: 12 } },
  media: { status: "saved", files: [{ role: "video", file: `Likes/maker_${id}.mp4`, bytes: 10, stream: {} }] },
  ...extra
});

test("an entry carries what the page shows, and only file roles and paths", () => {
  assert.deepEqual(galleryEntry(fromFeed("1", "1760000000000")), {
    id: "1",
    kind: "video",
    handle: "maker",
    name: "Maker",
    caption: "caption 1",
    postedAt: 1700000000000,
    likedAround: 1760000000000,
    duration: 12,
    hevc: false,
    saved: true,
    inLikes: true,
    files: [{ role: "video", file: "Likes/maker_1.mp4" }]
  });
});

test("items a completed full check did not see are marked as no longer in likes", () => {
  const seen = (at) => fromFeed("1", "1760000000000", { seenAt: [at] });
  assert.equal(galleryEntry(seen("2026-10-01T00:00:00.000Z")).inLikes, true);
  assert.equal(galleryEntry(seen("2026-10-01T00:00:00.000Z"), { lastFullCheckAt: "2026-10-02T00:00:00.000Z" }).inLikes, false);
  assert.equal(galleryEntry(seen("2026-10-03T00:00:00.000Z"), { lastFullCheckAt: "2026-10-02T00:00:00.000Z" }).inLikes, true);
});

test("HEVC videos are marked", () => {
  const hevc = fromFeed("4", "1");
  hevc.media.files[0].stream = { codecType: "h265_hvc1" };
  assert.equal(galleryEntry(hevc).hevc, true);
  assert.equal(galleryEntry(fromFeed("5", "1")).hevc, false);
});

test("failed and not-yet-attempted items appear as not saved", () => {
  assert.equal(galleryEntry(fromFeed("2", "1", { media: { status: "failed", reason: "http" } })).saved, false);
  const pending = galleryEntry(fromFeed("3", "1", { media: null }));
  assert.equal(pending.saved, false);
  assert.deepEqual(pending.files, []);
});

test("newest likes come first, using the page each item was found on", () => {
  const data = galleryData([fromFeed("9", "1750000000000"), fromFeed("1", "1740000000000"), fromFeed("2", "1760000000000")], { account: { uniqueId: "me" }, generatedAt: "now" });
  assert.deepEqual(data.items.map((i) => i.id), ["2", "9", "1"]);
  assert.equal(data.account, "me");
});

test("the archive's copy of the page carries its script inline", () => {
  const page = inlineGalleryPage('<script src="gallery-data.js"></script>\n<script src="gallery.js"></script>', "const a = '$&';");
  assert.equal(page, "<script src=\"gallery-data.js\"></script>\n<script>\nconst a = '$&';</script>");
  assert.throws(() => inlineGalleryPage("<html>", "x"));
  assert.throws(() => inlineGalleryPage('<script src="gallery.js"></script>', "'</script>'"));
});

test("the data file is a script that sets one global, and reads back without running it", () => {
  const data = { items: [{ id: "1", caption: "</script><b>;" }] };
  const script = galleryScript(data);
  const window = {};
  new Function("window", script)(window);
  assert.deepEqual(window.GALLERY, data);
  assert.deepEqual(parseGalleryScript(script), data);
  assert.throws(() => parseGalleryScript("alert(1)"));
});
