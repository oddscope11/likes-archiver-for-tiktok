// Streams media files from TikTok straight into the archive folder.

import { sniffExtension, SNIFF_BYTES } from "../lib/sniff.js";

export class DownloadError extends Error {
  constructor(code, detail = "") {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "DownloadError";
    this.code = code;
    this.detail = detail;
  }
}

// TikTok's video hosts only serve requests that look like they come from
// tiktok.com. This rule adds those headers to this extension's own requests
// and to nothing else, so normal browsing is untouched. It lasts until the
// browser closes.
export async function allowVideoDownloads() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [
      {
        id: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "Origin", operation: "set", value: "https://www.tiktok.com" },
            { header: "Referer", operation: "set", value: "https://www.tiktok.com/" }
          ]
        },
        condition: {
          initiatorDomains: [chrome.runtime.id],
          requestDomains: ["tiktok.com"],
          resourceTypes: ["xmlhttprequest"]
        }
      }
    ]
  });
}

// TikTok's own video hosts need the session cookies. Its CDN hosts are public;
// the extension has host access to both, so neither is subject to CORS.
const credentialsFor = (url) => (new URL(url).hostname.endsWith(".tiktok.com") ? "include" : "omit");

async function removeQuietly(dir, name) {
  await dir.removeEntry(name).catch(() => {});
}

async function downloadFrom(url, dir, part, signal) {
  let response;
  try {
    response = await fetch(url, { credentials: credentialsFor(url), signal });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new DownloadError("network", err.message);
  }
  if (!response.ok) throw new DownloadError("http", String(response.status));

  if (!response.body) throw new DownloadError("wrong_type", "empty response");
  const reader = response.body.getReader();

  // Read enough of the start to tell what kind of file this really is.
  const buffered = [];
  let head = new Uint8Array(0);
  try {
    while (head.length < SNIFF_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered.push(value);
      head = new Uint8Array([...head, ...value.subarray(0, SNIFF_BYTES)]);
    }
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new DownloadError("interrupted", err.message);
  }

  const extension = sniffExtension(head, part.role);
  if (!extension) {
    await reader.cancel().catch(() => {});
    throw new DownloadError("wrong_type", response.headers.get("content-type") ?? "unknown type");
  }

  const name = `${part.stem}.${extension}`;
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    // The browser writes to a temporary file and only replaces `name` on
    // close, so an interrupted download never leaves a partial file.
    for (const chunk of buffered) await writable.write(chunk);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
    }
    await writable.close();
  } catch (err) {
    await reader.cancel().catch(() => {});
    await writable.abort().catch(() => {});
    if ((await fileHandle.getFile()).size === 0) await removeQuietly(dir, name);
    if (err.name === "AbortError") throw err;
    throw new DownloadError("interrupted", err.message);
  }

  const bytes = (await fileHandle.getFile()).size;
  const declared = response.headers.get("content-encoding") ? 0 : Number(response.headers.get("content-length"));
  // The size TikTok lists for a video stream matches the served file exactly.
  const expected = part.expectedBytes || declared;
  if (bytes === 0 || (expected > 0 && bytes !== expected)) {
    await removeQuietly(dir, name);
    throw new DownloadError("incomplete", `${bytes} of ${expected || "unknown"} bytes`);
  }
  return { name, bytes };
}

// Tries each mirror in turn. Resolves to { name, bytes } for the saved file.
export async function downloadPart(dir, part, signal) {
  let lastError = new DownloadError("no_url");
  for (const url of part.urls) {
    try {
      return await downloadFrom(url, dir, part, signal);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      lastError = err;
    }
  }
  throw lastError;
}
