// The dashboard's strip of latest likes and its list of what this session
// saved. The strip starts from the gallery data written by the last run and
// takes each new item as soon as it is saved. Thumbnails come from the files
// on disk.

import { galleryEntry, parseGalleryScript, GALLERY_DATA } from "../lib/gallery.js";
import { MEDIA_DIR } from "../lib/plan.js";

const STRIP_SIZE = 24;
const strip = document.getElementById("latest");
const savedTable = document.getElementById("saved");
const savedEmpty = document.getElementById("saved-empty");
const stripEmpty = document.getElementById("latest-empty");
const refreshEmpty = () => (stripEmpty.hidden = strip.children.length > 0);

const formatDuration = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
const describe = (entry) => {
  const images = entry.files.filter((f) => f.role === "image").length;
  return entry.kind === "photo" ? `${images} photo${images === 1 ? "" : "s"}` : `video ${formatDuration(entry.duration)}`.trim();
};

async function fileUrl(mediaDir, path) {
  const name = path.slice(MEDIA_DIR.length + 1);
  return URL.createObjectURL(await (await mediaDir.getFileHandle(name)).getFile());
}

// A video's frame at one second is drawn into a canvas and the player is
// released, one video at a time. Chromium decodes HEVC in hardware, which
// takes only a few videos at once; a strip of live players left some blank.
let frames = Promise.resolve();

function drawFrame(li, url) {
  frames = frames.then(
    () =>
      new Promise((resolve) => {
        const video = document.createElement("video");
        video.muted = true;
        video.preload = "auto";
        const done = () => {
          clearTimeout(timer);
          video.removeAttribute("src");
          video.load();
          URL.revokeObjectURL(url);
          resolve();
        };
        const timer = setTimeout(done, 15000);
        video.addEventListener("loadeddata", () => {
          // No size means this browser cannot decode the video; keep the plain tile.
          if (video.videoWidth && li.isConnected) {
            const canvas = document.createElement("canvas");
            canvas.width = 216;
            canvas.height = Math.round((video.videoHeight / video.videoWidth) * 216);
            canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
            li.prepend(canvas);
          }
          done();
        }, { once: true });
        video.addEventListener("error", done, { once: true });
        video.src = `${url}#t=1`;
      })
  );
}

async function tile(entry, mediaDir) {
  const li = document.createElement("li");
  li.title = `@${entry.handle}${entry.caption ? `: ${entry.caption}` : ""}`;
  const image = entry.files.find((f) => f.role === "image");
  const video = entry.files.find((f) => f.role === "video");
  try {
    if (image) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = await fileUrl(mediaDir, image.file);
      li.append(img);
    } else if (video) {
      drawFrame(li, await fileUrl(mediaDir, video.file));
    }
  } catch {
    // A missing file leaves the plain tile.
  }
  const label = document.createElement("span");
  label.textContent = `@${entry.handle}`;
  li.append(label);
  return li;
}

function release(li) {
  for (const img of li.querySelectorAll("img")) URL.revokeObjectURL(img.src);
  li.remove();
}

// Shows the newest items from the last gallery data, if there is any.
export async function showLatest(folder) {
  for (const li of [...strip.children]) release(li);
  try {
    const text = await (await (await folder.getFileHandle(GALLERY_DATA)).getFile()).text();
    const mediaDir = await folder.getDirectoryHandle(MEDIA_DIR);
    const entries = parseGalleryScript(text).items.filter((entry) => entry.saved).slice(0, STRIP_SIZE);
    strip.append(...(await Promise.all(entries.map((entry) => tile(entry, mediaDir)))));
  } catch {
    // No gallery data yet: the strip fills as items are saved.
  }
  refreshEmpty();
}

// Called as soon as an item has been saved during a run.
export async function addSaved(record, mediaDir) {
  const entry = galleryEntry(record);
  const li = await tile(entry, mediaDir);
  li.classList.add("fresh");
  setTimeout(() => li.classList.remove("fresh"), 2500);
  strip.prepend(li);
  while (strip.children.length > STRIP_SIZE) release(strip.lastElementChild);
  refreshEmpty();

  const row = savedTable.insertRow(0);
  row.insertCell().textContent = `@${entry.handle}${entry.caption ? ` · ${entry.caption}` : ""}`;
  row.insertCell().textContent = describe(entry);
  row.insertCell().textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  savedEmpty.hidden = true;
}
