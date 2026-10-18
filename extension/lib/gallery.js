// Turns item records into the small data file the archive's gallery page
// reads. The page is opened straight from disk, where it may not read the
// records itself, so a run writes this file next to it.

import { isGone } from "./progress.js";

export const GALLERY_PAGE = "gallery.html";
export const GALLERY_DATA = "gallery-data.js";

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

// Cursors are millisecond timestamps of likes: a page's older cursor is when
// its last item was liked, and its newer cursor when the item just above the
// page was (or "0" on the first page, which was current when the item was
// last seen). Likes come after posting, too.
function likedBetween(record, postedAt) {
  const window = record.feedWindow ?? {};
  const after = Math.max(number(window.olderCursor), postedAt);
  const lastSeen = Date.parse(record.seenAt?.at(-1) ?? "") || 0;
  const before = number(window.newerCursor) || lastSeen;
  return [after, Math.max(before, after)];
}

// The feed's own order: newest page first, then the place on the page.
// Records from before places were kept fall back to the posting date.
function feedOrder(a, b) {
  const page = number(b.record.feedWindow?.olderCursor) - number(a.record.feedWindow?.olderCursor);
  const place = (a.record.feedWindow?.position ?? Infinity) - (b.record.feedWindow?.position ?? Infinity);
  return page || (Number.isNaN(place) ? 0 : place) || b.entry.postedAt - a.entry.postedAt || (a.entry.id < b.entry.id ? 1 : -1);
}

export function galleryEntry(record, { lastFullCheckAt = null } = {}) {
  const raw = record.raw;
  const media = record.media ?? {};
  const postedAt = number(raw?.createTime) * 1000;
  const [likedAfter, likedBefore] = likedBetween(record, postedAt);
  const files = (media.files ?? []).map((file) => ({ role: file.role, file: file.file }));
  const videoFile = (media.files ?? []).find((file) => file.role === "video");
  const codecName = videoFile?.stream?.codecType ?? "";
  return {
    id: record.id,
    kind: record.kind,
    handle: raw?.author?.uniqueId ?? "",
    name: raw?.author?.nickname ?? "",
    caption: raw?.desc ?? "",
    postedAt,
    likedAfter,
    likedBefore,
    duration: number(raw?.video?.duration),
    // Some browsers cannot decode HEVC; the page says so instead of failing.
    hevc: /265|hevc|hvc/i.test(codecName),
    saved: media.status === "saved",
    inLikes: !isGone(record, lastFullCheckAt),
    files
  };
}

// Newest likes first, in the order the likes feed lists them.
export function galleryData(records, { account, generatedAt, lastFullCheckAt = null }) {
  const items = records
    .map((record) => ({ record, entry: galleryEntry(record, { lastFullCheckAt }) }))
    .sort(feedOrder)
    .map(({ entry }) => entry);
  return { generatedAt, account: account?.uniqueId ?? null, items };
}

// The archive's copy of the page carries its script inline, so the folder
// holds just the page and its data.
export function inlineGalleryPage(html, script) {
  const tag = '<script src="gallery.js"></script>';
  if (!html.includes(tag) || /<\/script/i.test(script)) throw new Error("unexpected gallery page template");
  return html.replace(tag, () => `<script>\n${script}</script>`);
}

// The data file is plain JavaScript that sets one global.
const SCRIPT_START = "window.GALLERY = ";

export function galleryScript(data) {
  return `${SCRIPT_START}${JSON.stringify(data)};\n`;
}

// Reads a data file back, without running it.
export function parseGalleryScript(text) {
  const body = text.trim();
  if (!body.startsWith(SCRIPT_START) || !body.endsWith(";")) throw new Error("not a gallery data file");
  return JSON.parse(body.slice(SCRIPT_START.length, -1));
}
