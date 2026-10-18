// Turns item records into the small data file the archive's gallery page
// reads. The page is opened straight from disk, where it may not read the
// records itself, so a run writes this file next to it.

import { isGone } from "./progress.js";

export const GALLERY_PAGE = "gallery.html";
export const GALLERY_DATA = "gallery-data.js";

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

// Cursors are millisecond timestamps of likes, so the page an item was found
// on says roughly when it was liked.
function likedAround(record) {
  return number(record.feedWindow?.olderCursor) || number(record.feedWindow?.newerCursor);
}

export function galleryEntry(record, { lastFullCheckAt = null } = {}) {
  const raw = record.raw;
  const media = record.media ?? {};
  const files = (media.files ?? []).map((file) => ({ role: file.role, file: file.file }));
  const videoFile = (media.files ?? []).find((file) => file.role === "video");
  const codecName = videoFile?.stream?.codecType ?? "";
  return {
    id: record.id,
    kind: record.kind,
    handle: raw?.author?.uniqueId ?? "",
    name: raw?.author?.nickname ?? "",
    caption: raw?.desc ?? "",
    postedAt: number(raw?.createTime) * 1000,
    likedAround: likedAround(record),
    duration: number(raw?.video?.duration),
    // Some browsers cannot decode HEVC; the page says so instead of failing.
    hevc: /265|hevc|hvc/i.test(codecName),
    saved: media.status === "saved",
    inLikes: !isGone(record, lastFullCheckAt),
    files
  };
}

// Newest likes first. Items found on the same page share a like date, so
// among them the most recently posted comes first.
export function galleryData(records, { account, generatedAt, lastFullCheckAt = null }) {
  const items = records
    .map((record) => galleryEntry(record, { lastFullCheckAt }))
    .sort((a, b) => b.likedAround - a.likedAround || b.postedAt - a.postedAt || (a.id < b.id ? 1 : -1));
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
