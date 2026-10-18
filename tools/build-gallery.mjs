// Writes the gallery page and its data into an archive folder, the same way
// a run does. Useful without the extension, or after editing records by hand.
//
//   node tools/build-gallery.mjs <archive folder>

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { galleryData, galleryScript, inlineGalleryPage, GALLERY_PAGE, GALLERY_DATA } from "../extension/lib/gallery.js";
import { lastFullCheckAt } from "../extension/lib/progress.js";
import { THUMB_DIR } from "../extension/lib/plan.js";

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

const thumbsDir = join(root, THUMB_DIR);
const thumbs = new Set(existsSync(thumbsDir) ? readdirSync(thumbsDir).filter((n) => n.endsWith(".jpg")).map((n) => n.slice(0, -4)) : []);
const data = galleryData(records, { account: archive.account, generatedAt: new Date().toISOString(), lastFullCheckAt: lastFullCheckAt(archive), thumbs });
writeFileSync(join(root, GALLERY_DATA), galleryScript(data));
const source = (name) => readFileSync(fileURLToPath(new URL(`../extension/gallery/${name}`, import.meta.url)), "utf8");
writeFileSync(join(root, GALLERY_PAGE), inlineGalleryPage(source(GALLERY_PAGE), source("gallery.js")));
console.log(`Wrote ${GALLERY_PAGE} and ${GALLERY_DATA} (${data.items.length} items).`);
