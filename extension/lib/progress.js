// Decides which parts of the likes feed a run visits, and how long to suggest
// waiting after TikTok pushes back. Pure logic; the state lives in archive.json.

// The first download walks the whole feed once, oldest likes last. Its
// position is saved after every page so an interrupted walk can continue.
export function firstDownloadState(archive) {
  return archive?.firstDownload ?? { complete: false, nextCursor: null };
}

// The walks a run makes, in order. "updates" starts at the newest like and
// stops at the first page with nothing new. "first" (the first download) and
// "full" (a full check the user asked for) walk to the end of the feed,
// saving their position after every page; an interrupted one is continued by
// the next run, after a look at the top for new likes.
export function planWalks(archive, { full = false } = {}) {
  const resume = (kind, cursor) =>
    !cursor || cursor === "0" ? [{ kind, from: "0" }] : [{ kind: "updates", from: "0" }, { kind, from: cursor }];
  const first = firstDownloadState(archive);
  if (!first.complete) return resume("first", first.nextCursor);
  if (archive?.fullCheck) return resume("full", archive.fullCheck.nextCursor);
  if (full) return [{ kind: "full", from: "0" }];
  return [{ kind: "updates", from: "0" }];
}

// When the last completed walk through the whole feed started: a full check,
// or else the first download. Archives from before that was recorded fall
// back to when the archive was created, which is when the first download
// began.
export function lastFullCheckAt(archive) {
  if (archive?.lastFullCheckAt) return archive.lastFullCheckAt;
  const first = firstDownloadState(archive);
  return first.complete ? first.startedAt ?? archive.createdAt ?? null : null;
}

// Once a walk to the end of the feed has completed, an item it did not see is
// no longer in the likes: deleted, made private or unliked. `lastFullCheckAt`
// is when that walk started; an item seen again later is back.
export function isGone(record, lastFullCheckAt) {
  if (!lastFullCheckAt) return false;
  const lastSeen = record.seenAt?.at(-1) ?? record.firstSeenAt;
  return !(lastSeen >= lastFullCheckAt);
}

// An update walk stops at the first page holding nothing new. "New" means
// not yet seen when the last complete check of the top of the feed began, so
// items first seen by an interrupted walk still count as new and the next
// run walks past them instead of stopping on a page it only half finished.
export function topCheckedAt(archive) {
  return archive?.topCheckedAt ?? archive?.firstDownload?.completedAt ?? null;
}

export function isNew(existingRecord, checkedAt) {
  if (!existingRecord) return true;
  return checkedAt !== null && existingRecord.firstSeenAt > checkedAt;
}

// Failed items are retried by requesting just the page they were found on.
// `failures` maps item id to that page's cursor. Returns unique cursors for
// items this run has not already seen, at most `limit` of them.
export function retryCursors(failures, seenThisRun, limit) {
  const cursors = [];
  for (const [id, cursor] of Object.entries(failures ?? {})) {
    if (seenThisRun.has(id) || cursors.includes(cursor)) continue;
    cursors.push(cursor);
    if (cursors.length >= limit) break;
  }
  return cursors;
}

const HOUR = 60 * 60 * 1000;

// After TikTok pushes back, suggest waiting an hour, doubling with each further pushback
// on the same day, up to eight hours. `now` is in milliseconds.
export function nextCooldown(previous, now) {
  const day = new Date(now).toDateString();
  const strikes = previous?.day === day ? previous.strikes + 1 : 1;
  return { day, strikes, until: now + Math.min(HOUR * 2 ** (strikes - 1), 8 * HOUR) };
}
