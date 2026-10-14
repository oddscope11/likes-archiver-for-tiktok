// Decides which parts of the likes feed a run visits, and how long to suggest
// waiting after TikTok pushes back. Pure logic; the state lives in archive.json.

// The first download walks the whole feed once, oldest likes last. Its
// position is saved after every page so an interrupted walk can continue.
export function firstDownloadState(archive) {
  return archive?.firstDownload ?? { complete: false, nextCursor: null };
}

// The walks a run makes, in order. "updates" starts at the newest like and
// stops at the first page with nothing new; "first" continues the first
// download from where it stopped.
export function planWalks(state) {
  if (state.complete) return [{ kind: "updates", from: "0" }];
  if (state.nextCursor === null) return [{ kind: "first", from: "0" }];
  return [
    { kind: "updates", from: "0" },
    { kind: "first", from: state.nextCursor }
  ];
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

export function isCoolingDown(cooldown, now) {
  return Boolean(cooldown) && now < cooldown.until;
}
