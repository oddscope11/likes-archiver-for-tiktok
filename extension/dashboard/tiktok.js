// Talks to TikTok through an open, logged-in TikTok tab. Requests are made by
// the page itself, so they carry the session and TikTok's own request signing.

const TIKTOK_URL = "https://www.tiktok.com/";

export class TikTokError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "TikTokError";
    this.code = code;
    this.detail = detail;
  }
}

// --- Functions below this line run inside the TikTok page, not here. They are
// --- serialized by chrome.scripting, so they cannot use anything outside
// --- themselves.

function pageReadAccount() {
  const tag = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
  if (!tag) return { ready: false };
  try {
    const user = JSON.parse(tag.textContent)?.["__DEFAULT_SCOPE__"]?.["webapp.app-context"]?.user;
    if (!user?.secUid) return { ready: true, account: null };
    return {
      ready: true,
      account: { id: user.uid, secUid: user.secUid, uniqueId: user.uniqueId, nickname: user.nickName }
    };
  } catch {
    return { ready: false };
  }
}

async function pageFetchLikes(secUid, cursor) {
  const params = new URLSearchParams({
    aid: "1988",
    app_name: "tiktok_web",
    device_platform: "web_pc",
    secUid,
    count: "30",
    cursor,
    coverFormat: "2"
  });
  try {
    const res = await fetch("/api/favorite/item_list/?" + params, { credentials: "include" });
    return { status: res.status, text: await res.text() };
  } catch (err) {
    return { networkError: String(err) };
  }
}

// --- End of in-page functions.

async function runInPage(tabId, func, args = []) {
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args });
    return injection.result;
  } catch (err) {
    throw new TikTokError("tab_unreachable", err.message);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function openTikTok() {
  await chrome.tabs.create({ url: TIKTOK_URL });
}

// Finds a TikTok tab and the account logged in there.
export async function connect() {
  const tabs = await chrome.tabs.query({ url: TIKTOK_URL + "*" });
  const tab = tabs.find((t) => t.status === "complete") ?? tabs[0];
  if (!tab) throw new TikTokError("no_tab");

  // The page embeds the account a moment after it starts loading.
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await runInPage(tab.id, pageReadAccount);
    if (result?.ready) {
      if (!result.account) throw new TikTokError("logged_out");
      return { tabId: tab.id, account: result.account };
    }
    await sleep(500);
  }
  throw new TikTokError("tab_not_ready");
}

// Fetches one page of the likes feed and returns the parsed response body.
export async function fetchLikesPage(tabId, secUid, cursor) {
  const result = await runInPage(tabId, pageFetchLikes, [secUid, cursor]);
  if (!result) throw new TikTokError("tab_unreachable", "no result from the page");
  if (result.networkError) throw new TikTokError("network", result.networkError);
  if (result.status === 429) throw new TikTokError("rate_limited");
  if (result.status !== 200) throw new TikTokError("http", String(result.status));
  // TikTok answers 200 with an empty body when it refuses a request.
  if (!result.text) throw new TikTokError("refused");
  try {
    return JSON.parse(result.text);
  } catch {
    throw new TikTokError("refused", "response was not JSON");
  }
}
