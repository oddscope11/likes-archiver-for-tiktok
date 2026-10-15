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

// Builds the request the way TikTok's own Likes tab does, with the same
// parameters taken from the page's state (observed 2026-10-14; myfaveTT does
// the same). TikTok's page adds its signature (msToken, X-Bogus, X-Gnarly) to
// requests made through its fetch.
async function pageFetchLikes(secUid, cursor) {
  let scope = {};
  try {
    scope = JSON.parse(document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__").textContent).__DEFAULT_SCOPE__ ?? {};
  } catch {
    // Fall back to the parameters that do not depend on page state.
  }
  const app = scope["webapp.app-context"] ?? {};
  const seoTests = scope["seo.abtest"] ?? {};
  const abVersions = [
    ...(app.abTestVersion?.versionName?.split(",") ?? []),
    ...Object.values(seoTests.parameters?.clientABVersions ?? {}),
    ...(seoTests.vidList ?? [])
  ].filter(Boolean);
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "windows" : /Mac/.test(ua) ? "mac" : /Linux|X11/.test(ua) ? "linux" : "";

  const values = {
    WebIdLastTime: app.webIdCreatedTime,
    aid: "1988",
    app_language: app.language,
    app_name: "tiktok_web",
    browser_language: navigator.language,
    browser_name: navigator.appCodeName,
    browser_online: navigator.onLine,
    browser_platform: navigator.platform,
    browser_version: navigator.appVersion,
    channel: "tiktok_web",
    clientABVersions: abVersions.join(","),
    cookie_enabled: navigator.cookieEnabled,
    count: "16",
    coverFormat: "2",
    cursor,
    data_collection_enabled: true,
    device_id: app.wid,
    device_platform: "web_pc",
    focus_state: document.hasFocus(),
    from_page: "user",
    history_len: history.length,
    is_fullscreen: matchMedia("(display-mode: fullscreen)").matches,
    is_page_visible: document.visibilityState === "visible",
    language: app.language,
    needPinnedItemIds: true,
    odinId: app.odinId,
    os,
    post_item_list_request_type: "0",
    priority_region: app.user?.region,
    referer: document.referrer,
    region: app.region,
    root_referer: document.referrer,
    screen_height: screen.height,
    screen_width: screen.width,
    secUid,
    tz_name: Intl.DateTimeFormat().resolvedOptions().timeZone,
    user_is_login: true,
    verifyFp: document.cookie.match(/s_v_web_id=(\w+)/)?.[1],
    webcast_language: app.language
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  // Note the parameter names of the request as it actually left the page,
  // after TikTok's own code had its chance to sign it. Values are not kept.
  const sentKeys = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name.includes("/api/favorite/item_list/") && entry.name.includes(`cursor=${cursor}`)) {
        sentKeys.push(...new URL(entry.name).searchParams.keys());
      }
    }
  });
  observer.observe({ type: "resource" });
  try {
    const res = await fetch("/api/favorite/item_list/?" + params, { credentials: "include" });
    const text = await res.text();
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { status: res.status, text, sentKeys };
  } catch (err) {
    return { networkError: String(err) };
  } finally {
    observer.disconnect();
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

// What the most recent feed request looked like when it left the page: how
// many parameters it had and which of TikTok's signature fields were added.
export let lastFeedRequest = null;

const SIGNATURE_FIELDS = ["msToken", "X-Bogus", "X-Gnarly"];

// Fetches one page of the likes feed and returns the parsed response body.
export async function fetchLikesPage(tabId, secUid, cursor) {
  const result = await runInPage(tabId, pageFetchLikes, [secUid, cursor]);
  if (result?.sentKeys) {
    lastFeedRequest = result.sentKeys.length
      ? { parameters: result.sentKeys.length, signature: SIGNATURE_FIELDS.filter((key) => result.sentKeys.includes(key)) }
      : { parameters: null, signature: null, note: "request not observed" };
  }
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
