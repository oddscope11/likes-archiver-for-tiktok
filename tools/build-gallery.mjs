// Writes the gallery page and its data into an archive folder, the same way
// a run does. Useful without the extension, or after editing records by hand.
//
//   node tools/build-gallery.mjs <archive folder>

import { readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { galleryData, galleryScript, GALLERY_PAGE, GALLERY_DATA } from "../extension/lib/gallery.js";

const [root] = process.argv.slice(2);
if (!root) {
  console.error("usage: node tools/build-gallery.mjs <archive folder>");
  process.exit(2);
}

const itemsDir = join(root, "items");
const records = readdirSync(itemsDir)
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(readFileSync(join(itemsDir, name), "utf8")));
const archive = JSON.parse(readFileSync(join(root, "archive.json"), "utf8"));

const data = galleryData(records, { account: archive.account, generatedAt: new Date().toISOString() });
writeFileSync(join(root, GALLERY_DATA), galleryScript(data));
copyFileSync(fileURLToPath(new URL(`../extension/gallery/${GALLERY_PAGE}`, import.meta.url)), join(root, GALLERY_PAGE));
console.log(`Wrote ${GALLERY_PAGE} and ${GALLERY_DATA} (${data.items.length} items).`);
