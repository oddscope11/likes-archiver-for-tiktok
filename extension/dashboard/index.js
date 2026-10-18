import { walkFeed, parsePage, FeedError } from "../lib/feed.js";
import { firstDownloadState, planWalks, lastFullCheckAt, topCheckedAt, isNew, retryCursors, nextCooldown } from "../lib/progress.js";
import { buildRecord, isSaved, isValidId, missingFiles, RECORD_FORMAT } from "../lib/record.js";
import { planItem, safeHandle, MEDIA_DIR } from "../lib/plan.js";
import { withRetry, retryDelay } from "../lib/retry.js";
import { connect, fetchLikesPage, openTikTok, TikTokError } from "./tiktok.js";
import { pickFolder, rememberedFolder, regainAccess, readJson, writeJson, writeText } from "./folder.js";
import { galleryData, galleryScript, inlineGalleryPage, GALLERY_PAGE, GALLERY_DATA } from "../lib/gallery.js";
import { allowVideoDownloads, downloadPart, DownloadError } from "./download.js";
import { showLatest, addSaved } from "./latest.js";

const el = (id) => document.getElementById(id);

const accountStatus = el("account-status");
const openTikTokBtn = el("open-tiktok");
const folderStatus = el("folder-status");
const pickFolderBtn = el("pick-folder");
const regainFolderBtn = el("regain-folder");
const startBtn = el("start");
const stopBtn = el("stop");
const fullCheckBtn = el("full-check");
const runStatus = el("run-status");
const runCounts = el("run-counts");
const failuresList = el("failures");
const archiveStatus = el("archive-status");
const openGalleryBtn = el("open-gallery");
const cooldownNote = el("cooldown-note");
const failuresEmpty = el("failures-empty");

// Stop the run when this many downloads in a row are refused: TikTok is
// blocking us, and carrying on would only make it worse.
const MAX_REFUSALS_IN_A_ROW = 3;

// Failed items are retried by fetching the page they were on; at most this
// many such pages per run.
const MAX_RETRY_PAGES = 5;

// Errors that mean TikTok is pushing back. After one of these the dashboard
// suggests a time to wait until (see lib/progress.js); it never stops the
// user from starting again sooner.
const PUSHBACK = new Set(["verification", "tiktok_error", "stuck", "rate_limited", "refused", "http", "downloads_refused"]);

let session = null; // { tabId, account }
let folder = null; // FileSystemDirectoryHandle with write access
let pendingFolder = null; // remembered handle still waiting for access
let running = false;
let stopper = null; // AbortController of the current run

// What to tell the user for each failure, and what they can do about it.
const MESSAGES = {
  no_tab: "TikTok is not open. Open TikTok in a tab and keep it open while saving.",
  logged_out: "You are not logged in to TikTok. Log in on the TikTok tab.",
  tab_not_ready: "The TikTok tab is still loading.",
  tab_unreachable: "The TikTok tab could not be reached. Reload the TikTok tab, then try again.",
  network: "The connection to TikTok failed. Check your internet connection, then try again.",
  http: "TikTok returned an error.",
  rate_limited: "TikTok says there were too many requests.",
  verification: "TikTok is asking for a verification. Open the TikTok tab and complete the puzzle it shows.",
  refused: "TikTok did not answer the request. If the TikTok tab shows a verification, complete it.",
  tiktok_error: "TikTok reported an error.",
  unexpected_shape: "TikTok's response was not in the expected format. TikTok may have changed, and this extension needs an update.",
  stuck: "TikTok kept returning the same page.",
  account_changed: "The open TikTok tab is logged in to a different account than when this run started. Log back in to the original account, then start again.",
  downloads_refused: "TikTok refused several downloads in a row."
};

// Why a single item could not be saved.
const ITEM_REASONS = {
  http: "TikTok refused the download",
  network: "the connection failed",
  interrupted: "the download was cut off",
  incomplete: "the file arrived incomplete",
  wrong_type: "TikTok sent something that is not the expected kind of file",
  no_url: "TikTok gave no download address",
  no_stream: "TikTok offered no playable video",
  no_images: "TikTok offered no images",
  unknown_kind: "it is a kind of post this extension does not know"
};

class RunStopped extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const isKnownError = (err) => err instanceof TikTokError || err instanceof FeedError || err instanceof RunStopped;
const isPushback = (err) => isKnownError(err) && PUSHBACK.has(err.code);

function describe(err) {
  if (isKnownError(err)) {
    return `${MESSAGES[err.code] ?? "Something went wrong."} (${err.message})`;
  }
  return `Something went wrong: ${err.message}`;
}

function readCooldown() {
  try {
    return JSON.parse(localStorage.getItem("cooldown"));
  } catch {
    return null;
  }
}

function startCooldown() {
  const cooldown = nextCooldown(readCooldown(), Date.now());
  try {
    localStorage.setItem("cooldown", JSON.stringify(cooldown));
  } catch {
    // Without storage the suggestion only lasts while this page is open.
  }
  return cooldown;
}

const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

let cooldownTimer = null;

function refreshStart() {
  const cooldown = readCooldown();
  const cooling = Boolean(cooldown) && Date.now() < cooldown.until;
  startBtn.disabled = running || !session || !folder;
  fullCheckBtn.disabled = startBtn.disabled;
  cooldownNote.hidden = !cooling || running;
  clearTimeout(cooldownTimer);
  if (cooling) {
    cooldownNote.textContent = `TikTok pushed back on the last run. It is a good idea to wait until ${timeOf(cooldown.until)} before starting again; starting sooner makes a verification puzzle more likely.`;
    cooldownTimer = setTimeout(refreshStart, cooldown.until - Date.now() + 1000);
  }
}

// Writes the gallery page and its data into the archive folder. Runs after
// every run, however it ended; it only reads local files.
async function writeGallery(dir) {
  const archive = await readJson(dir, "archive.json");
  if (!archive) return;
  const itemsDir = await dir.getDirectoryHandle("items", { create: true });
  const records = [];
  for await (const [name, handle] of itemsDir.entries()) {
    if (handle.kind !== "file" || !name.endsWith(".json")) continue;
    records.push(JSON.parse(await (await handle.getFile()).text()));
  }
  const source = (name) => fetch(chrome.runtime.getURL(`gallery/${name}`)).then((res) => res.text());
  const page = inlineGalleryPage(await source(GALLERY_PAGE), await source("gallery.js"));
  const data = galleryData(records, { account: archive.account, generatedAt: new Date().toISOString(), lastFullCheckAt: lastFullCheckAt(archive) });
  await writeText(dir, GALLERY_DATA, galleryScript(data));
  await writeText(dir, GALLERY_PAGE, page);
}

function describeArchive(archive) {
  const state = firstDownloadState(archive);
  if (state.complete && archive.fullCheck) {
    return "A full check of your likes is not finished. Start checks for new likes, then continues it from where it stopped.";
  }
  if (state.complete) {
    const checked = new Date(lastFullCheckAt(archive) ?? Date.now()).toLocaleDateString();
    return `All your likes are saved. Start fetches what you have liked since. Full check goes through all of them again${fullCheckLength(archive)} to find anything missing and anything no longer in your likes (last done ${checked}).`;
  }
  if (state.nextCursor) {
    return "The first download of your likes is not finished. Start checks for new likes, then continues from where it stopped.";
  }
  return "Nothing has been downloaded yet. Start begins the first download of all your likes.";
}

// Rough length of a full check, from how many likes the last full walk saw:
// 16 per page, about 7 seconds apart.
function fullCheckLength(archive) {
  if (!archive.likesCount) return "";
  const pages = Math.ceil(archive.likesCount / 16);
  return ` (about ${pages} pages, roughly ${Math.max(1, Math.round((pages * 7) / 60))} minutes)`;
}

async function showArchiveState() {
  if (!folder) return;
  try {
    const archive = await readJson(folder, "archive.json");
    archiveStatus.textContent = describeArchive(archive);
    openGalleryBtn.hidden = !archive;
    fullCheckBtn.hidden = !firstDownloadState(archive).complete || Boolean(archive.fullCheck);
  } catch (err) {
    archiveStatus.textContent = `The archive in this folder could not be read: ${err.message}`;
  }
}

async function checkAccount() {
  try {
    session = await connect();
    const { nickname, uniqueId } = session.account;
    accountStatus.textContent = `Connected as ${nickname ?? uniqueId} (@${uniqueId}).`;
    openTikTokBtn.hidden = true;
  } catch (err) {
    session = null;
    accountStatus.textContent = describe(err);
    openTikTokBtn.hidden = err.code !== "no_tab";
  }
  refreshStart();
}

// The account status follows the TikTok tabs: it is checked again whenever
// one opens, finishes loading, changes address or closes. Logging in or out
// reloads TikTok's page, so that is noticed too. A run manages its own tab,
// so checks wait until it ends.
let accountCheck = null;
let accountTimer = null;

function scheduleAccountCheck() {
  clearTimeout(accountTimer);
  accountTimer = setTimeout(async () => {
    if (running) return;
    if (accountCheck) {
      await accountCheck;
      return scheduleAccountCheck();
    }
    accountCheck = checkAccount().finally(() => (accountCheck = null));
  }, 400);
}

const isTikTok = (url) => typeof url === "string" && url.startsWith("https://www.tiktok.com/");

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if ((change.status === "complete" || change.url) && (isTikTok(tab.url) || tabId === session?.tabId)) scheduleAccountCheck();
});
chrome.tabs.onRemoved.addListener(scheduleAccountCheck);

function useFolder(handle) {
  folder = handle;
  pendingFolder = null;
  folderStatus.textContent = `Saving to the folder “${handle.name}”.`;
  pickFolderBtn.textContent = "Change";
  regainFolderBtn.hidden = true;
  refreshStart();
  showArchiveState();
  showLatest(handle);
}

async function restoreFolder() {
  const remembered = await rememberedFolder();
  if (!remembered) return;
  if (remembered.granted) {
    useFolder(remembered.handle);
    return;
  }
  pendingFolder = remembered.handle;
  folderStatus.textContent = `The folder “${remembered.handle.name}” needs your permission again.`;
  regainFolderBtn.hidden = false;
}

// Refuses to mix two accounts' likes in one folder.
async function prepareArchive(account, now) {
  const existing = await readJson(folder, "archive.json");
  if (existing && existing.account?.id !== account.id) {
    throw new Error(
      `This folder already holds the archive of @${existing.account?.uniqueId}. Choose a different folder for @${account.uniqueId}.`
    );
  }
  const archive = existing ?? {
    format: RECORD_FORMAT,
    createdAt: now,
    account: { id: account.id, uniqueId: account.uniqueId }
  };
  if (!existing) await writeJson(folder, "archive.json", archive);
  return archive;
}

function renderCounts(counts) {
  runCounts.textContent =
    `${counts.seen} likes read: ${counts.saved} saved now, ${counts.alreadySaved} already saved` +
    (counts.failed ? `, ${counts.failed} could not be saved` : "") +
    (counts.invalid ? `, ${counts.invalid} unreadable` : "") +
    ".";
}

function reportProblem(text) {
  const line = document.createElement("li");
  line.textContent = text;
  failuresList.append(line);
  failuresEmpty.hidden = true;
}

function reportFailure(item, media) {
  const line = document.createElement("li");
  const reason = ITEM_REASONS[media.reason] ?? "something went wrong";
  const details = [media.part, media.detail].filter(Boolean).join(": ");
  line.textContent = `@${safeHandle(item.author?.uniqueId)} (${item.id}): ${reason}${details ? ` (${details})` : ""}`;
  failuresList.append(line);
  failuresEmpty.hidden = true;
}

// Resolves after `ms`, or rejects as soon as the run is stopped.
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Downloads everything for one item. Resolves to the record's `media` value,
// which says either what was saved or why it could not be.
async function saveItem(item, mediaDir, knownFiles, signal) {
  const plan = planItem(item);
  if (plan.problem) return { status: "failed", at: new Date().toISOString(), reason: plan.problem };

  const files = [];
  const notes = [...plan.notes];
  let current = null;
  try {
    for (const part of plan.parts) {
      current = part;
      const saved = await downloadPart(mediaDir, part, signal);
      knownFiles.add(saved.name);
      files.push({
        role: part.role,
        file: `${MEDIA_DIR}/${saved.name}`,
        bytes: saved.bytes,
        ...(part.stream && { stream: part.stream })
      });
    }
  } catch (err) {
    if (err.name === "AbortError") throw err;
    return {
      status: "failed",
      at: new Date().toISOString(),
      reason: err instanceof DownloadError ? err.code : "error",
      part: current?.stem,
      detail: err instanceof DownloadError ? err.detail : err.message
    };
  }
  return { status: "saved", savedAt: new Date().toISOString(), files, notes };
}

async function run({ full = false } = {}) {
  running = true;
  stopper = new AbortController();
  const { signal } = stopper;
  startBtn.hidden = true;
  fullCheckBtn.hidden = true;
  stopBtn.hidden = false;
  runStatus.className = "";
  runCounts.textContent = "";
  failuresList.replaceChildren();
  failuresEmpty.hidden = false;
  refreshStart();

  const counts = { seen: 0, saved: 0, alreadySaved: 0, failed: 0, invalid: 0 };
  const now = new Date().toISOString();

  try {
    runStatus.textContent = "Connecting to TikTok…";
    session = await connect();
    await allowVideoDownloads();
    let archive = await prepareArchive(session.account, now);
    const saveArchive = async (changes) => {
      archive = { ...archive, ...changes };
      await writeJson(folder, "archive.json", archive);
    };

    const itemsDir = await folder.getDirectoryHandle("items", { create: true });
    const mediaDir = await folder.getDirectoryHandle(MEDIA_DIR, { create: true });

    // Directory listings up front, kept current as the run adds to them.
    const knownFiles = new Set();
    for await (const name of mediaDir.keys()) knownFiles.add(name);
    const fileExists = (path) => knownFiles.has(path.slice(MEDIA_DIR.length + 1));
    const checkedAt = topCheckedAt(archive);
    const seenThisRun = new Set();

    // Saved items whose files have gone missing are fetched again through
    // the page they were found on, like failed items.
    runStatus.textContent = "Checking the files in the folder…";
    const missing = { ...archive.failures };
    for await (const [name, handle] of itemsDir.entries()) {
      if (handle.kind !== "file" || !name.endsWith(".json")) continue;
      const record = JSON.parse(await (await handle.getFile()).text());
      const cursor = missingFiles(record, fileExists);
      if (cursor === undefined) continue;
      if (cursor === null) {
        reportProblem(`@${record.raw?.author?.uniqueId ?? "?"} (${record.id}): files are missing from the folder, and there is no page to download them again from`);
      } else {
        missing[record.id] = cursor;
      }
    }
    if (Object.keys(missing).length !== Object.keys(archive.failures ?? {}).length) await saveArchive({ failures: missing });

    // If the TikTok tab is closed or reloaded mid-run, carry on through any
    // other open TikTok tab, as long as it is logged in to the same account.
    const fetchPageAnyTab = async (cursor) => {
      try {
        return await fetchLikesPage(session.tabId, session.account.secUid, cursor);
      } catch (err) {
        if (!(err instanceof TikTokError && err.code === "tab_unreachable")) throw err;
        const next = await connect();
        if (next.account.id !== session.account.id) throw new RunStopped("account_changed");
        session = next;
        return fetchLikesPage(session.tabId, session.account.secUid, cursor);
      }
    };

    // Validating inside the retry lets a one-off TikTok error be retried.
    const fetchPage = (cursor) =>
      withRetry(
        async () => {
          const body = await fetchPageAnyTab(cursor);
          parsePage(body);
          return body;
        },
        { delayFor: retryDelay, wait: (ms) => wait(ms, signal) }
      );
    const pause = () => wait(5000 + Math.random() * 4000, signal);
    const walkFrom = (startCursor) => walkFeed({ fetchPage, pause, startCursor });

    let refusalsInARow = 0;

    // Saves what is missing from one page. Returns how many of its items are
    // new (see isNew).
    const processPage = async (page) => {
      let fresh = 0;
      for (const item of page.items) {
        signal.throwIfAborted();
        counts.seen++;
        if (!isValidId(item?.id)) {
          counts.invalid++;
          continue;
        }
        seenThisRun.add(item.id);

        const name = `${item.id}.json`;
        const existing = await readJson(itemsDir, name);
        if (isNew(existing, checkedAt)) fresh++;
        const record = buildRecord(item, existing, { now, ...page });

        // Record the sighting before downloading, so it survives a crash.
        await writeJson(itemsDir, name, record);

        if (isSaved(record, fileExists)) {
          counts.alreadySaved++;
          continue;
        }

        runStatus.textContent = `Saving a ${record.kind === "photo" ? "photo post" : "video"} by @${safeHandle(item.author?.uniqueId)}…`;
        record.media = await saveItem(item, mediaDir, knownFiles, signal);
        await writeJson(itemsDir, name, record);

        // archive.json lists failed items and the page each was found on.
        const failures = { ...archive.failures };
        if (record.media.status === "saved") {
          counts.saved++;
          addSaved(record, mediaDir).catch(() => {});
          refusalsInARow = 0;
          if (item.id in failures) {
            delete failures[item.id];
            await saveArchive({ failures });
          }
        } else {
          counts.failed++;
          reportFailure(item, record.media);
          failures[item.id] = record.feedWindow.newerCursor;
          await saveArchive({ failures });
          if (record.media.reason === "http" && ++refusalsInARow >= MAX_REFUSALS_IN_A_ROW) {
            throw new RunStopped("downloads_refused");
          }
        }
        renderCounts(counts);
        await wait(1000 + Math.random() * 1500, signal);
      }
      renderCounts(counts);
      return fresh;
    };

    // Walks to the end of the feed: the first download and full checks. Each
    // saves its position after every page, and when it started, since an
    // item it did not see by the end is no longer in the likes.
    let liked = 0;
    const walkToEnd = async (walk, key, label) => {
      if (walk.from === "0") {
        await saveArchive({ topCheckedAt: now, [key]: { complete: false, nextCursor: "0", startedAt: now } });
      }
      runStatus.textContent = label;
      for await (const page of walkFrom(walk.from)) {
        await processPage(page);
        liked += page.items.length;
        await saveArchive({ [key]: { ...archive[key], nextCursor: page.olderCursor } });
        runStatus.textContent = label;
      }
      // A walk continued from a saved position only counts its own pages.
      const counted = walk.from === "0" ? { likesCount: liked } : {};
      // A first download begun before start times were recorded began when
      // the archive was created.
      return { startedAt: archive[key]?.startedAt ?? archive.createdAt, ...counted };
    };

    for (const walk of planWalks(archive, { full })) {
      if (walk.kind === "updates") {
        runStatus.textContent = "Checking for new likes…";
        let reachedEnd = true;
        for await (const page of walkFrom(walk.from)) {
          if ((await processPage(page)) === 0) {
            reachedEnd = false;
            break;
          }
        }
        // The top of the feed is now fully checked.
        await saveArchive({ topCheckedAt: now });
        // Walking all the way down covers whatever the first download or an
        // unfinished full check missed, and counts as a full check.
        if (reachedEnd) {
          await saveArchive({
            firstDownload: { ...firstDownloadState(archive), complete: true, nextCursor: null, completedAt: archive.firstDownload?.completedAt ?? now },
            fullCheck: null,
            lastFullCheckAt: now
          });
          break;
        }
      } else if (walk.kind === "first") {
        const { startedAt, ...counted } = await walkToEnd(walk, "firstDownload", "Downloading all your likes…");
        await saveArchive({ firstDownload: { complete: true, nextCursor: null, startedAt, completedAt: now }, ...counted });
      } else {
        const { startedAt, ...counted } = await walkToEnd(walk, "fullCheck", "Checking all your likes…");
        await saveArchive({ fullCheck: null, lastFullCheckAt: startedAt, ...counted });
      }
    }

    // Retry earlier failures this run did not pass by.
    for (const cursor of retryCursors(archive.failures, seenThisRun, MAX_RETRY_PAGES)) {
      runStatus.textContent = "Retrying items that failed before…";
      await pause();
      const page = parsePage(await fetchPage(cursor));
      await processPage({ items: page.items, newerCursor: cursor, olderCursor: page.cursor });
    }

    runStatus.textContent = Object.keys(archive.failures ?? {}).length
      ? "Finished, but some items could not be saved. Start again later to retry them."
      : "Done. Everything you have liked is saved in the folder.";
  } catch (err) {
    if (err.name === "AbortError") {
      runStatus.textContent = "Stopped. Everything saved so far is kept; start again any time.";
    } else {
      runStatus.className = "error";
      const until = isPushback(err) ? ` It is a good idea to wait until ${timeOf(startCooldown().until)} before starting again.` : "";
      runStatus.textContent = `${describe(err)} Everything saved so far is kept.${until}`;
    }
  } finally {
    if (folder) {
      try {
        await writeGallery(folder);
      } catch (err) {
        runStatus.textContent += ` (The gallery page could not be updated: ${err.message})`;
      }
    }
    renderCounts(counts);
    running = false;
    stopper = null;
    startBtn.hidden = false;
    stopBtn.hidden = true;
    refreshStart();
    showArchiveState();
    scheduleAccountCheck();
  }
}

openTikTokBtn.addEventListener("click", openTikTok);
openGalleryBtn.addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL(`gallery/${GALLERY_PAGE}`) }));

pickFolderBtn.addEventListener("click", async () => {
  try {
    useFolder(await pickFolder());
  } catch (err) {
    if (err.name !== "AbortError") folderStatus.textContent = `The folder could not be opened: ${err.message}`;
  }
});

regainFolderBtn.addEventListener("click", async () => {
  if (pendingFolder && (await regainAccess(pendingFolder))) useFolder(pendingFolder);
});

startBtn.addEventListener("click", () => run());
fullCheckBtn.addEventListener("click", () => run({ full: true }));
stopBtn.addEventListener("click", () => {
  runStatus.textContent = "Stopping…";
  stopper?.abort(new DOMException("Stopped by the user", "AbortError"));
});

el("version").textContent = "v" + chrome.runtime.getManifest().version;
restoreFolder();
checkAccount();
