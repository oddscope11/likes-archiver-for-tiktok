import { test } from "node:test";
import assert from "node:assert/strict";
import { galleryEntry, galleryData, galleryScript, inlineGalleryPage } from "../extension/lib/gallery.js";

const fromFeed = (id, olderCursor, extra = {}) => ({
  id,
  kind: "video",
  feedWindow: { newerCursor: "0", olderCursor },
  raw: { id, desc: `caption ${id}`, createTime: 1700000000, author: { uniqueId: "maker", nickname: "Maker" }, video: { duration: 12 } },
  media: { status: "saved", files: [{ role: "video", file: `Likes/maker_${id}.mp4`, bytes: 10, stream: {} }] },
  ...extra
});

const imported = {
  id: "9",
  kind: "video",
  feedWindow: null,
  raw: null,
  media: { status: "saved", files: [{ role: "video", file: "Likes/old_9.mp4", bytes: 5, probed: {} }] },
  legacy: { likesDb: { author_handle: "old", author_nickname: "Old", description: "gone", create_time: 1600000000, duration: 0, saved_at: 1750000000 } }
};

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

test("records imported from v1 use v1's metadata and are marked as no longer in likes", () => {
  const entry = galleryEntry(imported);
  assert.equal(entry.handle, "old");
  assert.equal(entry.caption, "gone");
  assert.equal(entry.likedAround, 1750000000000);
  assert.equal(entry.inLikes, false);
});

test("HEVC videos are marked, from the chosen stream or from ffprobe for imports", () => {
  const hevc = fromFeed("4", "1");
  hevc.media.files[0].stream = { codecType: "h265_hvc1" };
  assert.equal(galleryEntry(hevc).hevc, true);
  const old = structuredClone(imported);
  old.media.files[0].probed = { codec: "hevc" };
  assert.equal(galleryEntry(old).hevc, true);
  assert.equal(galleryEntry(imported).hevc, false);
});

test("failed and not-yet-attempted items appear as not saved", () => {
  assert.equal(galleryEntry(fromFeed("2", "1", { media: { status: "failed", reason: "http" } })).saved, false);
  const pending = galleryEntry(fromFeed("3", "1", { media: null }));
  assert.equal(pending.saved, false);
  assert.deepEqual(pending.files, []);
});

test("newest likes come first, using the page each item was found on", () => {
  const data = galleryData([imported, fromFeed("1", "1740000000000"), fromFeed("2", "1760000000000")], { account: { uniqueId: "me" }, generatedAt: "now" });
  assert.deepEqual(data.items.map((i) => i.id), ["2", "9", "1"]);
  assert.equal(data.account, "me");
});

test("the data file is a script that sets one global", () => {
  const script = galleryScript({ items: [{ caption: "</script><b>" }] });
  const window = {};
  new Function("window", script)(window);
  assert.equal(window.GALLERY.items[0].caption, "</script><b>");
});

test("the archive's copy of the page carries its script inline", () => {
  const page = inlineGalleryPage('<script src="gallery-data.js"></script>\n<script src="gallery.js"></script>', "const a = '$&';");
  assert.equal(page, "<script src=\"gallery-data.js\"></script>\n<script>\nconst a = '$&';</script>");
  assert.throws(() => inlineGalleryPage("<html>", "x"));
  assert.throws(() => inlineGalleryPage('<script src="gallery.js"></script>', "'</script>'"));
});
