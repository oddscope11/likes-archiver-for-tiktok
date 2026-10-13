import { walkFeed, FeedError } from "../lib/feed.js";
import { buildRecord, isSaved, isValidId, RECORD_FORMAT } from "../lib/record.js";
import { planItem, safeHandle, MEDIA_DIR } from "../lib/plan.js";
import { withRetry } from "../lib/retry.js";
import { connect, fetchLikesPage, openTikTok, TikTokError } from "./tiktok.js";
import { pickFolder, rememberedFolder, regainAccess, readJson, writeJson } from "./folder.js";
import { allowVideoDownloads, downloadPart, DownloadError } from "./download.js";

const el = (id) => document.getElementById(id);

const accountStatus = el("account-status");
const openTikTokBtn = el("open-tiktok");
const checkAccountBtn = el("check-account");
const folderStatus = el("folder-status");
const pickFolderBtn = el("pick-folder");
const regainFolderBtn = el("regain-folder");
const startBtn = el("start");
const stopBtn = el("stop");
const runStatus = el("run-status");
const runCounts = el("run-counts");
const failuresList = el("failures");

// Stop the run when this many downloads in a row are refused: TikTok is
// blocking us, and carrying on would only make it worse.
const MAX_REFUSALS_IN_A_ROW = 3;

let session = null; // { tabId, account }
let folder = null; // FileSystemDirectoryHandle with write access
let pendingFolder = null; // remembered handle still waiting for access
let running = false;
let stopper = null; // AbortController of the current run

// What to tell the user for each failure, and what they can do about it.
const MESSAGES = {
  no_tab: "TikTok is not open. Open TikTok, log in, then come back here.",
  logged_out: "You are not logged in to TikTok. Log in on the TikTok tab, then press Check again.",
  tab_not_ready: "The TikTok tab is still loading. Wait a moment, then press Check again.",
  tab_unreachable: "The TikTok tab could not be reached. Reload the TikTok tab, then try again.",
  network: "The connection to TikTok failed. Check your internet connection, then try again.",
  http: "TikTok returned an error. Wait a few minutes, then try again.",
  rate_limited: "TikTok says there were too many requests. Wait an hour, then try again.",
  verification: "TikTok is asking for a verification. Open the TikTok tab, complete the puzzle it shows, then start again.",
  refused: "TikTok did not answer the request. Open the TikTok tab and complete any verification it shows, then try again later.",
  tiktok_error: "TikTok reported an error. Wait a few minutes, then try again.",
  unexpected_shape: "TikTok's response was not in the expected format. TikTok may have changed, and this extension needs an update.",
  stuck: "TikTok kept returning the same page. Wait a few minutes, then try again.",
  downloads_refused: "TikTok refused several downloads in a row. Wait an hour, then start again."
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

function describe(err) {
  if (err instanceof TikTokError || err instanceof FeedError || err instanceof RunStopped) {
    return `${MESSAGES[err.code] ?? "Something went wrong."} (${err.message})`;
  }
  return `Something went wrong: ${err.message}`;
}

function refreshStart() {
  startBtn.disabled = running || !session || !folder;
}

async function checkAccount() {
  accountStatus.textContent = "Checking…";
  openTikTokBtn.hidden = true;
  checkAccountBtn.hidden = true;
  try {
    session = await connect();
    const { nickname, uniqueId } = session.account;
    accountStatus.textContent = `Connected as ${nickname ?? uniqueId} (@${uniqueId}).`;
  } catch (err) {
    session = null;
    accountStatus.textContent = describe(err);
    openTikTokBtn.hidden = false;
    checkAccountBtn.hidden = false;
  }
  refreshStart();
}

function useFolder(handle) {
  folder = handle;
  pendingFolder = null;
  folderStatus.textContent = `Saving to the folder “${handle.name}”.`;
  pickFolderBtn.textContent = "Choose a different folder";
  regainFolderBtn.hidden = true;
  refreshStart();
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

function reportFailure(item, media) {
  const line = document.createElement("li");
  const reason = ITEM_REASONS[media.reason] ?? "something went wrong";
  const details = [media.part, media.detail].filter(Boolean).join(": ");
  line.textContent = `@${safeHandle(item.author?.uniqueId)} (${item.id}): ${reason}${details ? ` (${details})` : ""}`;
  failuresList.append(line);
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

// Temporary feed problems are retried a few times before the run gives up.
function retryDelay(err, attempt) {
  if (!(err instanceof TikTokError)) return null;
  if (err.code === "rate_limited") return 60_000;
  if (err.code === "network" || (err.code === "http" && err.detail.startsWith("5"))) return 7_000 * attempt;
  return null;
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

async function run() {
  running = true;
  stopper = new AbortController();
  const { signal } = stopper;
  startBtn.hidden = true;
  stopBtn.hidden = false;
  runStatus.className = "";
  runCounts.textContent = "";
  failuresList.replaceChildren();
  refreshStart();

  const counts = { seen: 0, saved: 0, alreadySaved: 0, failed: 0, invalid: 0 };
  const now = new Date().toISOString();

  try {
    runStatus.textContent = "Connecting to TikTok…";
    session = await connect();
    await allowVideoDownloads();
    const archive = await prepareArchive(session.account, now);
    const itemsDir = await folder.getDirectoryHandle("items", { create: true });
    const mediaDir = await folder.getDirectoryHandle(MEDIA_DIR, { create: true });

    // One listing of the media folder up front, kept current as files are added.
    const knownFiles = new Set();
    for await (const name of mediaDir.keys()) knownFiles.add(name);
    const fileExists = (path) => knownFiles.has(path.slice(MEDIA_DIR.length + 1));

    const pages = walkFeed({
      fetchPage: (cursor) =>
        withRetry(() => fetchLikesPage(session.tabId, session.account.secUid, cursor), {
          delayFor: retryDelay,
          wait: (ms) => wait(ms, signal)
        }),
      pause: () => wait(5000 + Math.random() * 4000, signal)
    });

    let refusalsInARow = 0;

    for await (const page of pages) {
      for (const item of page.items) {
        signal.throwIfAborted();
        counts.seen++;
        if (!isValidId(item?.id)) {
          counts.invalid++;
          continue;
        }

        const name = `${item.id}.json`;
        const record = buildRecord(item, await readJson(itemsDir, name), { now, ...page });

        // Record the sighting before downloading, so it survives a crash.
        await writeJson(itemsDir, name, record);

        if (isSaved(record, fileExists)) {
          counts.alreadySaved++;
          continue;
        }

        runStatus.textContent = `Saving a ${record.kind === "photo" ? "photo post" : "video"} by @${safeHandle(item.author?.uniqueId)}…`;
        record.media = await saveItem(item, mediaDir, knownFiles, signal);
        await writeJson(itemsDir, name, record);

        if (record.media.status === "saved") {
          counts.saved++;
          refusalsInARow = 0;
        } else {
          counts.failed++;
          reportFailure(item, record.media);
          if (record.media.reason === "http" && ++refusalsInARow >= MAX_REFUSALS_IN_A_ROW) {
            throw new RunStopped("downloads_refused");
          }
        }
        renderCounts(counts);
        await wait(1000 + Math.random() * 1500, signal);
      }
      runStatus.textContent = "Reading your likes…";
      renderCounts(counts);
    }

    await writeJson(folder, "archive.json", { ...archive, lastCompleteScanAt: now });
    runStatus.textContent = counts.failed
      ? "Finished, but some items could not be saved. Start again later to retry them."
      : "Done. Everything you have liked is saved in the folder.";
  } catch (err) {
    if (err.name === "AbortError") {
      runStatus.textContent = "Stopped. Everything saved so far is kept; start again any time.";
    } else {
      runStatus.className = "error";
      runStatus.textContent = `${describe(err)} Everything saved so far is kept.`;
    }
  } finally {
    renderCounts(counts);
    running = false;
    stopper = null;
    startBtn.hidden = false;
    stopBtn.hidden = true;
    refreshStart();
  }
}

openTikTokBtn.addEventListener("click", openTikTok);
checkAccountBtn.addEventListener("click", checkAccount);

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

startBtn.addEventListener("click", run);
stopBtn.addEventListener("click", () => {
  runStatus.textContent = "Stopping…";
  stopper?.abort(new DOMException("Stopped by the user", "AbortError"));
});

el("version").textContent = "v" + chrome.runtime.getManifest().version;
restoreFolder();
checkAccount();
