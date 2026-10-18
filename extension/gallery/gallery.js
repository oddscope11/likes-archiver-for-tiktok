"use strict";

// Opened from the archive folder, gallery-data.js sets window.GALLERY. Opened
// by the extension, it sets window.GALLERY_SOURCE instead, which loads the
// data from the folder and turns media paths into links the page can use.
let data = window.GALLERY;
const source = window.GALLERY_SOURCE;
const el = (id) => document.getElementById(id);
const grid = el("grid");
const viewer = el("viewer");

// Paths in the data are relative to the archive folder, like "Likes/name.mp4".
const href = (path) => (source ? source.href(path) : path.split("/").map(encodeURIComponent).join("/"));

function make(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

const formatDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "unknown");
// The like's exact time is not known, only a range; a range within one day
// is shown as that day.
const formatRange = (after, before) =>
  !after || formatDate(after) === formatDate(before) ? formatDate(after || before) : `between ${formatDate(after)} and ${formatDate(before)}`;
const formatDuration = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
const filesOf = (item, role) => item.files.filter((f) => f.role === role);

// Chromium decodes HEVC only with hardware support, so it often cannot.
const canPlayHevc = document.createElement("video").canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== "";
const HEVC_NOTE = "This browser cannot show HEVC video, so you may hear sound with no picture. The file itself is fine: open it in a video player such as VLC or mpv.";

// --- Thumbnails. A video's first frame is drawn into a canvas and the video
// --- is released, so only a few players exist at once.

const thumbQueue = [];
let thumbsBusy = 0;
const MAX_THUMBS_AT_ONCE = 4;

function pumpThumbs() {
  while (thumbsBusy < MAX_THUMBS_AT_ONCE && thumbQueue.length) {
    const job = thumbQueue.shift();
    if (!job.box.isConnected) continue;
    thumbsBusy++;
    drawFirstFrame(job.box, job.file).finally(() => {
      thumbsBusy--;
      pumpThumbs();
    });
  }
}

function drawFirstFrame(box, file) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    const done = () => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve();
    };
    const timer = setTimeout(done, 15000);
    video.addEventListener("loadeddata", () => {
      // A browser that cannot decode the codec reports no size; keep the
      // plain tile then.
      if (!video.videoWidth) return done();
      const canvas = document.createElement("canvas");
      const scale = 240 / Math.max(video.videoWidth, 1);
      canvas.width = 240;
      canvas.height = Math.round(video.videoHeight * scale) || 427;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      box.prepend(canvas);
      done();
    }, { once: true });
    video.addEventListener("error", done, { once: true });
    video.src = href(file) + "#t=1";
  });
}

const thumbObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    thumbObserver.unobserve(entry.target);
    const item = entry.target._item;
    const [image] = filesOf(item, "image");
    const [video] = filesOf(item, "video");
    if (item.thumb) {
      entry.target.prepend(make("img", { src: href(item.thumb), alt: "", decoding: "async" }));
      continue;
    }
    if (video && item.hevc && !canPlayHevc) continue;
    if (image) {
      entry.target.prepend(make("img", { src: href(image.file), alt: "", loading: "lazy", decoding: "async" }));
    } else if (video) {
      thumbQueue.push({ box: entry.target, file: video.file });
      pumpThumbs();
    }
  }
}, { rootMargin: "600px 0px" });

// --- Grid.

let shown = [];

function tile(item, index) {
  const thumb = make("div", { class: "thumb" });
  thumb._item = item;
  const images = filesOf(item, "image").length;
  if (!item.saved) thumb.append(make("span", { class: "badge top", text: "Not saved" }));
  else if (!item.inLikes) thumb.append(make("span", { class: "badge top", text: "No longer in likes" }));
  const corner = item.kind === "photo" ? `${images} photo${images === 1 ? "" : "s"}` : formatDuration(item.duration);
  if (corner) thumb.append(make("span", { class: "badge", text: corner }));
  thumbObserver.observe(thumb);

  const button = make("button", { class: "tile", "aria-label": `@${item.handle}: ${item.caption}` }, [
    thumb,
    make("div", { class: "meta" }, [
      make("div", { class: "handle", text: `@${item.handle}` }),
      make("div", { class: "caption", text: item.caption || " " })
    ])
  ]);
  button.addEventListener("click", () => openViewer(index));
  return make("li", {}, [button]);
}

function matches(item, words, filter) {
  if (filter === "video" && item.kind !== "video") return false;
  if (filter === "photo" && item.kind !== "photo") return false;
  if (filter === "gone" && item.inLikes) return false;
  if (filter === "unsaved" && item.saved) return false;
  if (!words.length) return true;
  const text = `${item.handle} ${item.name} ${item.caption}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

function render() {
  const words = el("search").value.toLowerCase().split(/\s+/).filter(Boolean);
  const filter = el("filter").value;
  shown = data.items.filter((item) => matches(item, words, filter));
  thumbQueue.length = 0;
  grid.replaceChildren(...shown.map(tile));
  el("empty").hidden = shown.length > 0;
  el("empty").textContent = "Nothing matches.";
}

// --- Viewer.

let current = -1;

function openViewer(index) {
  current = index;
  showCurrent();
  if (!viewer.open) viewer.showModal();
}

function stopMedia() {
  for (const media of el("stage").querySelectorAll("video, audio")) {
    media.pause();
    media.removeAttribute("src");
    media.load();
  }
}

function showCurrent() {
  stopMedia();
  const item = shown[current];
  const stage = el("stage");
  stage.replaceChildren();

  const [video] = filesOf(item, "video");
  const images = filesOf(item, "image");
  const [audio] = filesOf(item, "audio");

  if (video) {
    stage.append(make("video", { src: href(video.file), controls: "", autoplay: "", loop: "" }));
    if (item.hevc && !canPlayHevc) stage.append(make("p", { class: "label", text: HEVC_NOTE }));
  } else if (images.length) {
    let page = 0;
    const img = make("img", { alt: "" });
    const label = make("span");
    const back = make("button", { "aria-label": "Previous photo", text: "‹" });
    const forward = make("button", { "aria-label": "Next photo", text: "›" });
    const showPage = () => {
      img.src = href(images[page].file);
      label.textContent = `${page + 1} / ${images.length}`;
      back.disabled = page === 0;
      forward.disabled = page === images.length - 1;
    };
    back.addEventListener("click", () => { page--; showPage(); });
    forward.addEventListener("click", () => { page++; showPage(); });
    showPage();
    stage.append(img);
    if (images.length > 1) stage.append(make("div", { class: "photo-nav" }, [back, label, forward]));
    if (audio) stage.append(make("audio", { src: href(audio.file), controls: "", autoplay: "", loop: "" }));
  } else {
    stage.append(make("p", { text: "This item was not saved." }));
  }

  const link = make("a", {
    href: `https://www.tiktok.com/@${encodeURIComponent(item.handle)}/${item.kind === "photo" ? "photo" : "video"}/${item.id}`,
    target: "_blank",
    rel: "noreferrer",
    text: "Open on TikTok"
  });
  el("info").replaceChildren(
    make("p", {}, [make("strong", { text: item.name || item.handle }), make("br"), make("span", { text: `@${item.handle}` })]),
    make("p", { text: item.caption }),
    make("p", {}, [make("span", { class: "label", text: "Posted " }), make("span", { text: formatDate(item.postedAt) })]),
    make("p", {}, [make("span", { class: "label", text: "Liked " }), make("span", { text: formatRange(item.likedAfter, item.likedBefore) })]),
    ...(item.inLikes ? [] : [make("p", { class: "label", text: "No longer in your likes: deleted, made private or unliked." })]),
    make("p", {}, [link]),
    ...item.files.map((file) => make("p", {}, [make("a", { href: href(file.file), target: "_blank", text: file.file.split("/").pop() })]))
  );

  el("prev").disabled = current === 0;
  el("next").disabled = current === shown.length - 1;
}

function step(delta) {
  const next = current + delta;
  if (next >= 0 && next < shown.length) {
    current = next;
    showCurrent();
  }
}

el("prev").addEventListener("click", () => step(-1));
el("next").addEventListener("click", () => step(1));
el("close").addEventListener("click", () => viewer.close());
viewer.addEventListener("close", stopMedia);
viewer.addEventListener("click", (event) => {
  if (event.target === viewer) viewer.close();
});
document.addEventListener("keydown", (event) => {
  if (!viewer.open) return;
  if (event.key === "ArrowLeft") step(-1);
  if (event.key === "ArrowRight") step(1);
});

// --- Start.

function showProblem(text) {
  el("empty").hidden = false;
  el("empty").textContent = text;
}

function start() {
  if (!data) return showProblem("gallery-data.js is missing. Run the archiver once to create it.");
  const saved = data.items.filter((item) => item.saved).length;
  el("summary").textContent = `${data.items.length} items, ${saved} saved · updated ${formatDate(Date.parse(data.generatedAt))}`;
  let typing = null;
  el("search").addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(render, 150);
  });
  el("filter").addEventListener("change", render);
  render();
}

if (source) {
  showProblem("Loading…");
  source.load(showProblem).then((loaded) => {
    if (!loaded) return;
    data = loaded;
    el("empty").hidden = true;
    start();
  });
} else {
  start();
}
