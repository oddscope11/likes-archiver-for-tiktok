import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../extension/", import.meta.url));
const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));

test("manifest references files that exist", () => {
  const files = [manifest.background.service_worker, ...Object.values(manifest.icons)];
  for (const file of files) {
    assert.ok(existsSync(root + file), `${file} is missing`);
  }
});

test("manifest requests only what the extension uses", () => {
  assert.deepEqual(manifest.permissions, ["scripting"]);
  assert.deepEqual(manifest.host_permissions, ["https://www.tiktok.com/*"]);
});
