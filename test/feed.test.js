import { test } from "node:test";
import assert from "node:assert/strict";
import { walkFeed, parsePage, FeedError } from "../extension/lib/feed.js";

const page = (ids, cursor, hasMore) => ({
  statusCode: 0,
  itemList: ids.map((id) => ({ id })),
  cursor,
  hasMore
});

// Serves the given pages in order and records the cursors that were requested.
function feed(pages) {
  const requested = [];
  let pauses = 0;
  return {
    requested,
    pauses: () => pauses,
    options: {
      fetchPage: async (cursor) => {
        requested.push(cursor);
        return pages[requested.length - 1];
      },
      pause: async () => {
        pauses++;
      }
    }
  };
}

async function collect(options) {
  const ids = [];
  for await (const p of walkFeed(options)) ids.push(...p.items.map((i) => i.id));
  return ids;
}

const rejectsWith = (code) => (err) => err instanceof FeedError && err.code === code;

test("walks every page and follows the cursor", async () => {
  const f = feed([page(["a", "b"], "200", true), page(["c"], "100", false)]);
  assert.deepEqual(await collect(f.options), ["a", "b", "c"]);
  assert.deepEqual(f.requested, ["0", "200"]);
  assert.equal(f.pauses(), 1);
});

test("an empty page mid-feed does not end the walk", async () => {
  const f = feed([page(["a"], "300", true), page([], "200", true), page(["b"], "100", false)]);
  assert.deepEqual(await collect(f.options), ["a", "b"]);
});

test("a page without itemList counts as empty", async () => {
  const f = feed([{ statusCode: 0, cursor: "200", hasMore: true }, page(["a"], "100", false)]);
  assert.deepEqual(await collect(f.options), ["a"]);
});

test("reports which cursors bracket each page", async () => {
  const f = feed([page(["a"], "200", true), page(["b"], "100", false)]);
  const windows = [];
  for await (const p of walkFeed(f.options)) windows.push([p.newerCursor, p.olderCursor]);
  assert.deepEqual(windows, [["0", "200"], ["200", "100"]]);
});

test("a TikTok error status stops the walk", async () => {
  const f = feed([{ statusCode: 10201, status_msg: "blocked", hasMore: false, cursor: "0" }]);
  await assert.rejects(collect(f.options), rejectsWith("tiktok_error"));
});

test("a verification request is reported as such", async () => {
  const f = feed([{ statusCode: 10000, type: "verify" }]);
  await assert.rejects(collect(f.options), rejectsWith("verification"));
});

test("an unchanged cursor stops the walk instead of looping", async () => {
  const f = feed([page(["a"], "200", true), page(["b"], "200", true)]);
  await assert.rejects(collect(f.options), rejectsWith("stuck"));
});

test("too many empty pages in a row stops the walk", async () => {
  const pages = Array.from({ length: 4 }, (_, i) => page([], String(900 - i), true));
  const f = feed(pages);
  await assert.rejects(collect({ ...f.options, maxEmptyPages: 2 }), rejectsWith("stuck"));
});

test("unexpected response shapes are rejected", () => {
  const bad = [
    null,
    [],
    "text",
    { statusCode: 0, cursor: "1" },
    { statusCode: 0, hasMore: true },
    { statusCode: 0, hasMore: true, cursor: "1", itemList: {} }
  ];
  for (const body of bad) {
    assert.throws(() => parsePage(body), rejectsWith("unexpected_shape"), JSON.stringify(body));
  }
});

test("accepts status_code and numeric cursors", () => {
  assert.deepEqual(parsePage({ status_code: 0, hasMore: false, cursor: 5, itemList: [] }), {
    items: [],
    cursor: "5",
    hasMore: false
  });
});
