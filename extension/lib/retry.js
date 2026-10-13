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
