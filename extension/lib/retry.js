// Retries an action a few times, waiting longer after each failure.
// `delayFor(error, attempt)` returns how long to wait, or null to give up now.
export async function withRetry(action, { attempts = 3, delayFor, wait }) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await action();
    } catch (err) {
      const delay = attempt < attempts ? delayFor(err, attempt) : null;
      if (delay === null || delay === undefined) throw err;
      await wait(delay);
    }
  }
}

// The retry policy for likes-feed requests. Network failures and server
// errors are retried with growing waits, a rate limit after a minute, and an
// unexplained TikTok error code once (as myfaveTT does). Verifications,
// refusals and anything else end the run at once.
export function retryDelay(err, attempt) {
  if (err?.name === "FeedError") return err.code === "tiktok_error" && attempt === 1 ? 30_000 : null;
  if (err?.name !== "TikTokError") return null;
  if (err.code === "rate_limited") return 60_000;
  if (err.code === "network" || (err.code === "http" && err.detail.startsWith("5"))) return 7_000 * attempt;
  return null;
}
