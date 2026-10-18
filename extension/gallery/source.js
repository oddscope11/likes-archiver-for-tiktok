// Loads the gallery's data from the archive folder the extension has access
// to: the same gallery-data.js a run writes for the folder's copy of the
// page. Media files become object URLs that point at the files on disk
// without copying them.

import { rememberedFolder, regainAccess } from "../dashboard/folder.js";
import { parseGalleryScript, GALLERY_DATA } from "../lib/gallery.js";
import { MEDIA_DIR, THUMB_DIR } from "../lib/plan.js";

// Chromium asks for a click before it grants folder access again.
function askForAccess(handle, report) {
  return new Promise((resolve) => {
    report(`The folder “${handle.name}” needs your permission again.`);
    const button = document.createElement("button");
    button.textContent = "Allow access to the folder";
    button.style.marginLeft = "0.75rem";
    button.addEventListener("click", async () => {
      if (await regainAccess(handle)) {
        button.remove();
        resolve(true);
      }
    });
    document.getElementById("empty").append(button);
  });
}

export async function load(urls, report) {
  try {
    const remembered = await rememberedFolder();
    if (!remembered) {
      report("No archive folder has been chosen yet. Choose one on the extension's main page.");
      return null;
    }
    const folder = remembered.handle;
    if (!remembered.granted) await askForAccess(folder, report);
    report("Loading…");

    let data;
    try {
      data = parseGalleryScript(await (await (await folder.getFileHandle(GALLERY_DATA)).getFile()).text());
    } catch {
      report("The archive folder has no gallery yet. Start a run on the extension's main page first.");
      return null;
    }

    const files = [];
    for (const dirName of [MEDIA_DIR, THUMB_DIR]) {
      let dir;
      try {
        dir = await folder.getDirectoryHandle(dirName);
      } catch {
        continue;
      }
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === "file") files.push([`${dirName}/${name}`, handle]);
      }
    }

    await Promise.all(files.map(async ([path, handle]) => urls.set(path, URL.createObjectURL(await handle.getFile()))));

    if (data.account) document.title = `Liked TikToks · @${data.account}`;
    return data;
  } catch (err) {
    report(`The archive folder could not be read: ${err.message}`);
    return null;
  }
}
