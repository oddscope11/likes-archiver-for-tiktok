// Walks a TikTok cursor-paginated feed. Pure logic: the caller supplies how a
// page is fetched and how to wait between pages.

export class FeedError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "FeedError";
    this.code = code;
    this.detail = detail;
  }
}

// Validates one response body and reduces it to what the walker needs.
// Anything unexpected is an error rather than a guess (see README, principle 7).
export function parsePage(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new FeedError("unexpected_shape", "response is not an object");
  }

  const statusCode = body.statusCode ?? body.status_code;
  if (statusCode !== 0) {
    // TikTok wants the user to solve a captcha before it answers.
    if (body.type === "verify") throw new FeedError("verification");
    throw new FeedError("tiktok_error", `status ${statusCode} ${body.status_msg ?? ""}`.trim());
  }

  if (typeof body.hasMore !== "boolean") {
    throw new FeedError("unexpected_shape", "hasMore is missing");
  }

  // TikTok may omit itemList on an empty page, but it is never another type.
  const items = body.itemList ?? [];
  if (!Array.isArray(items)) {
    throw new FeedError("unexpected_shape", "itemList is not a list");
  }

  const cursor = body.cursor;
  if (typeof cursor !== "string" && typeof cursor !== "number") {
    throw new FeedError("unexpected_shape", "cursor is missing");
  }

  return { items, cursor: String(cursor), hasMore: body.hasMore };
}

// Yields every page until TikTok says there are no more. Short and empty pages
// are normal mid-feed, so only `hasMore: false` ends the walk. The generator
// returning (rather than throwing) means the whole feed was seen.
export async function* walkFeed({ fetchPage, pause, maxEmptyPages = 5 }) {
  let cursor = "0";
  let emptyPages = 0;

  for (let index = 0; ; index++) {
    const page = parsePage(await fetchPage(cursor));

    yield { index, items: page.items, newerCursor: cursor, olderCursor: page.cursor };

    if (!page.hasMore) return;

    if (page.cursor === cursor) {
      throw new FeedError("stuck", `cursor did not advance past ${cursor}`);
    }

    emptyPages = page.items.length === 0 ? emptyPages + 1 : 0;
    if (emptyPages > maxEmptyPages) {
      throw new FeedError("stuck", `${emptyPages} empty pages in a row`);
    }

    cursor = page.cursor;
    await pause();
  }
}
