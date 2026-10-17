// Turns item records into the small data file the archive's gallery page
// reads. The page is opened straight from disk, where it may not read the
// records itself, so a run writes this file next to it.

export const GALLERY_PAGE = "gallery.html";
export const GALLERY_DATA = "gallery-data.js";

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

// Cursors are millisecond timestamps of likes, so the page an item was found
// on says roughly when it was liked. Records imported from v1 only know when
// v1 saved them, which is shortly after the like.
function likedAround(record) {
  const window = record.feedWindow;
  if (window) return number(window.olderCursor) || number(window.newerCursor);
  return number(record.legacy?.likesDb?.saved_at) * 1000;
}

export function galleryEntry(record) {
  const raw = record.raw;
  const legacy = record.legacy?.likesDb;
  const media = record.media ?? {};
  const files = (media.files ?? []).map((file) => ({ role: file.role, file: file.file }));
  const videoFile = (media.files ?? []).find((file) => file.role === "video");
  const codecName = `${videoFile?.stream?.codecType ?? ""} ${videoFile?.probed?.codec ?? ""}`;
  return {
    id: record.id,
    kind: record.kind,
    handle: raw?.author?.uniqueId ?? legacy?.author_handle ?? "",
    name: raw?.author?.nickname ?? legacy?.author_nickname ?? "",
    caption: raw?.desc ?? legacy?.description ?? "",
    postedAt: number(raw?.createTime ?? legacy?.create_time) * 1000,
    likedAround: likedAround(record),
    duration: number(raw?.video?.duration ?? legacy?.duration),
    // Some browsers cannot decode HEVC; the page says so instead of failing.
    hevc: /265|hevc|hvc/i.test(codecName),
    saved: media.status === "saved",
    // Imported items are the ones the likes feed no longer listed.
    inLikes: raw !== null,
    files
  };
}

// Newest likes first. Items found on the same page keep a stable order.
export function galleryData(records, { account, generatedAt }) {
  const items = records
    .map(galleryEntry)
    .sort((a, b) => b.likedAround - a.likedAround || b.postedAt - a.postedAt || (a.id < b.id ? 1 : -1));
  return { generatedAt, account: account?.uniqueId ?? null, items };
}

// The data file is plain JavaScript that sets one global.
export function galleryScript(data) {
  return `window.GALLERY = ${JSON.stringify(data)};\n`;
}
