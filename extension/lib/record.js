// The per-item record stored in the archive folder as items/<id>.json.

export const RECORD_FORMAT = 1;

// The id becomes a file name, so it must be exactly what TikTok ids look like.
export function isValidId(id) {
  return typeof id === "string" && /^\d{1,32}$/.test(id);
}

export function classify(item) {
  if (item.imagePost) return "photo";
  if (item.video?.playAddr || item.video?.bitrateInfo?.length) return "video";
  return "unknown";
}

// Builds the record for an item just seen in the feed, carrying over what an
// earlier run already knew about it.
export function buildRecord(item, existing, { now, newerCursor, olderCursor }) {
  return {
    // Fields this version does not manage, such as `legacy`, are kept.
    ...existing,
    format: RECORD_FORMAT,
    id: item.id,
    kind: classify(item),
    firstSeenAt: existing?.firstSeenAt ?? now,
    seenAt: [...(existing?.seenAt ?? []), now],
    // The feed page the item was first found on. Cursors look like millisecond
    // timestamps of the like, so this brackets when the item was liked.
    feedWindow: existing?.feedWindow ?? { newerCursor, olderCursor },
    media: existing?.media ?? null,
    raw: item
  };
}

// True when the record says the item is saved and every file is still there.
export function isSaved(record, fileExists) {
  return record.media?.status === "saved" && record.media.files.every((entry) => fileExists(entry.file));
}

// For an item whose files are not all on disk, though it is recorded as saved
// or a run stopped before trying it: the cursor of the feed page to fetch it
// again from, or null when it cannot be fetched again (items imported from
// the first version have no page). Failed items are tracked elsewhere.
export function missingFiles(record, fileExists) {
  if (record.media?.status === "failed" || isSaved(record, fileExists)) return undefined;
  return record.feedWindow?.newerCursor ?? null;
}
