// Makes a gallery thumbnail from a saved video: its frame at one second (or
// the middle of a shorter video), as a small JPEG. Everything happens
// locally; nothing is fetched.

const WIDTH = 240;

// Resolves to a JPEG Blob, or null when this browser cannot decode the video.
export function makeThumbnail(file, signal) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    const finish = (blob) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(blob);
    };
    const stop = () => finish(null);
    const timer = setTimeout(stop, 15000);
    signal?.addEventListener("abort", stop, { once: true });
    video.addEventListener("error", stop, { once: true });
    video.addEventListener("loadedmetadata", () => {
      // No size means the browser cannot decode this video.
      if (!video.videoWidth) return stop();
      video.currentTime = Math.min(1, (video.duration || 0) / 2);
    }, { once: true });
    video.addEventListener("seeked", () => {
      const canvas = document.createElement("canvas");
      canvas.width = WIDTH;
      canvas.height = Math.round((video.videoHeight / video.videoWidth) * WIDTH);
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(finish, "image/jpeg", 0.8);
    }, { once: true });
    video.src = url;
  });
}
