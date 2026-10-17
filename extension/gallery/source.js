// Loads the gallery's data straight from the archive folder the extension
// has access to. Media files become object URLs that point at the files on
// disk without copying them.

import { rememberedFolder, regainAccess, readJson } from "../dashboard/folder.js";
import { galleryData } from "../lib/gallery.js";
import { MEDIA_DIR } from "../lib/plan.js";

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

    const archive = await readJson(folder, "archive.json");
    if (!archive) {
      report("The archive folder is empty. Start a run on the extension's main page first.");
      return null;
    }

    const records = [];
    const itemsDir = await folder.getDirectoryHandle("items");
    for await (const [name, handle] of itemsDir.entries()) {
      if (handle.kind === "file" && name.endsWith(".json")) records.push(handle);
    }
    const mediaFiles = [];
    const mediaDir = await folder.getDirectoryHandle(MEDIA_DIR);
    for await (const [name, handle] of mediaDir.entries()) {
      if (handle.kind === "file") mediaFiles.push([name, handle]);
    }

    const parsed = await Promise.all(records.map(async (handle) => JSON.parse(await (await handle.getFile()).text())));
    await Promise.all(
      mediaFiles.map(async ([name, handle]) => urls.set(`${MEDIA_DIR}/${name}`, URL.createObjectURL(await handle.getFile())))
    );

    document.title = `Liked TikToks · @${archive.account?.uniqueId ?? ""}`;
    return galleryData(parsed, { account: archive.account, generatedAt: new Date().toISOString() });
  } catch (err) {
    report(`The archive folder could not be read: ${err.message}`);
    return null;
  }
}
