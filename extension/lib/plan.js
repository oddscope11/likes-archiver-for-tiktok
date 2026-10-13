// Turns a liked item into the list of files to save for it.

import { classify } from "./record.js";
import { rankStreams } from "./select.js";

export const MEDIA_DIR = "Likes";

// Media types we accept for each kind of file, and the extension each gets.
// Anything else (such as an HTML error page) is treated as a failed download.
export const EXTENSIONS = {
  video: { "video/mp4": "mp4" },
  image: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  audio: { "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/x-m4a": "m4a" }
};

// Creator handles become part of file names, so keep only safe characters.
export function safeHandle(uniqueId) {
  const cleaned = String(uniqueId ?? "")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/^[.-]+/, "")
    .slice(0, 40);
  return cleaned || "unknown";
}

const httpsUrls = (list) => (list ?? []).filter((url) => typeof url === "string" && url.startsWith("https://"));

// Returns { parts, notes } describing what to download, or { problem } when
// the item has nothing that can be saved. Each part's `stem` is its file name
// without the extension, which is only known once the download responds.
export function planItem(item) {
  const stem = `${safeHandle(item.author?.uniqueId)}_${item.id}`;
  const kind = classify(item);

  if (kind === "video") {
    const [best] = rankStreams(item);
    if (!best) return { problem: "no_stream" };
    const { urls, ...stream } = best;
    return { parts: [{ role: "video", stem, urls, expectedBytes: best.bytes, stream }], notes: [] };
  }

  if (kind === "photo") {
    const images = item.imagePost.images ?? [];
    const parts = images.map((image, index) => ({
      role: "image",
      stem: `${stem}_${String(index + 1).padStart(2, "0")}`,
      urls: httpsUrls(image.imageURL?.urlList)
    }));
    if (parts.length === 0 || parts.some((part) => part.urls.length === 0)) return { problem: "no_images" };

    const audio = httpsUrls([item.music?.playUrl]);
    if (audio.length === 0) return { parts, notes: ["no_audio"] };
    return { parts: [...parts, { role: "audio", stem: `${stem}_audio`, urls: audio }], notes: [] };
  }

  return { problem: "unknown_kind" };
}
