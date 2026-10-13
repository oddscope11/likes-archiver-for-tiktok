import { walkFeed, FeedError } from "../lib/feed.js";
import { buildRecord, isValidId, RECORD_FORMAT } from "../lib/record.js";
import { connect, fetchLikesPage, openTikTok, TikTokError } from "./tiktok.js";
import { pickFolder, rememberedFolder, regainAccess, readJson, writeJson } from "./folder.js";

const el = (id) => document.getElementById(id);

const accountStatus = el("account-status");
const openTikTokBtn = el("open-tiktok");
const checkAccountBtn = el("check-account");
const folderStatus = el("folder-status");
const pickFolderBtn = el("pick-folder");
const regainFolderBtn = el("regain-folder");
const startBtn = el("start");
const stopBtn = el("stop");
const scanStatus = el("scan-status");
const scanCounts = el("scan-counts");

let session = null; // { tabId, account }
let folder = null; // FileSystemDirectoryHandle with write access
let pendingFolder = null; // remembered handle still waiting for access
let scanning = false;
let stopRequested = false;

// What to tell the user for each failure, and what they can do about it.
const MESSAGES = {
  no_tab: "TikTok is not open. Open TikTok, log in, then come back here.",
  logged_out: "You are not logged in to TikTok. Log in on the TikTok tab, then press Check again.",
  tab_not_ready: "The TikTok tab is still loading. Wait a moment, then press Check again.",
  tab_unreachable: "The TikTok tab could not be reached. Reload the TikTok tab, then try again.",
  network: "The connection to TikTok failed. Check your internet connection, then try again.",
  http: "TikTok returned an error. Wait a few minutes, then try again.",
  refused: "TikTok did not answer the request. Open the TikTok tab and complete any verification it shows, then try again later.",
  tiktok_error: "TikTok reported an error. Wait a few minutes, then try again.",
  unexpected_shape: "TikTok's response was not in the expected format. TikTok may have changed, and this extension needs an update.",
  stuck: "TikTok kept returning the same page. Wait a few minutes, then try again."
};

function describe(err) {
  if (err instanceof TikTokError || err instanceof FeedError) {
    return `${MESSAGES[err.code] ?? "Something went wrong."} (${err.message})`;
  }
  return `Something went wrong: ${err.message}`;
}

function refreshStart() {
  startBtn.disabled = scanning || !session || !folder;
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
  scanCounts.textContent =
    `${counts.total} items seen: ${counts.added} new, ${counts.known} already recorded. ` +
    `${counts.video} videos, ${counts.photo} photo posts` +
    (counts.unknown ? `, ${counts.unknown} of an unknown kind` : "") +
    (counts.invalid ? `, ${counts.invalid} skipped as unreadable` : "") +
    ".";
}

// Waits a few seconds between pages, ending early if the user presses Stop.
async function pause() {
  const until = Date.now() + 3000 + Math.random() * 2000;
  while (Date.now() < until && !stopRequested) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function scan() {
  scanning = true;
  stopRequested = false;
  startBtn.hidden = true;
  stopBtn.hidden = false;
  scanStatus.className = "";
  scanCounts.textContent = "";
  refreshStart();

  const counts = { total: 0, added: 0, known: 0, invalid: 0, video: 0, photo: 0, unknown: 0 };
  const now = new Date().toISOString();

  try {
    scanStatus.textContent = "Connecting to TikTok…";
    session = await connect();
    const archive = await prepareArchive(session.account, now);
    const itemsDir = await folder.getDirectoryHandle("items", { create: true });

    const pages = walkFeed({
      fetchPage: (cursor) => fetchLikesPage(session.tabId, session.account.secUid, cursor),
      pause
    });

    for await (const page of pages) {
      for (const item of page.items) {
        counts.total++;
        if (!isValidId(item?.id)) {
          counts.invalid++;
          continue;
        }
        const name = `${item.id}.json`;
        const existing = await readJson(itemsDir, name);
        const record = buildRecord(item, existing, { now, ...page });
        await writeJson(itemsDir, name, record);
        counts[existing ? "known" : "added"]++;
        counts[record.kind]++;
      }
      scanStatus.textContent = `Reading your likes… page ${page.index + 1}`;
      renderCounts(counts);
      if (stopRequested) break;
    }

    if (stopRequested) {
      scanStatus.textContent = "Stopped. What was read so far is saved; start again any time.";
    } else {
      await writeJson(folder, "archive.json", { ...archive, lastCompleteScanAt: now });
      scanStatus.textContent = "Done. Every like TikTok listed is recorded in the folder.";
    }
  } catch (err) {
    scanStatus.className = "error";
    scanStatus.textContent = `${describe(err)} What was read so far is saved.`;
  } finally {
    renderCounts(counts);
    scanning = false;
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

startBtn.addEventListener("click", scan);
stopBtn.addEventListener("click", () => {
  stopRequested = true;
  scanStatus.textContent = "Stopping…";
});

el("version").textContent = "v" + chrome.runtime.getManifest().version;
restoreFolder();
checkAccount();
