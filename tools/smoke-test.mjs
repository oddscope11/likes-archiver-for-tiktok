// Loads the extension in a throwaway headless Chromium profile and checks
// that the dashboard opens without errors. Makes no requests to TikTok.
//
//   node tools/smoke-test.mjs [path to chromium]
//
// With SCREENSHOT=path.png set, it also saves a picture of the dashboard.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const chromium = process.argv[2] ?? "chromium";
const extension = fileURLToPath(new URL("../extension", import.meta.url));
const profile = mkdtempSync(join(tmpdir(), "archiver-smoke-"));
const port = 9300 + Math.floor(Math.random() * 600);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = spawn(
  chromium,
  [
    "--headless=new",
    "--no-first-run",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    `--load-extension=${extension}`,
    `--disable-extensions-except=${extension}`,
    "about:blank"
  ],
  { stdio: "ignore" }
);

let failed = false;
try {
  let worker;
  for (let i = 0; i < 40 && !worker; i++) {
    await sleep(500);
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => []);
    worker = targets.find((t) => t.type === "service_worker" && t.url.endsWith("/background.js"));
  }
  if (!worker) throw new Error("the extension's service worker never started");

  const id = new URL(worker.url).host;
  const page = await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${id}/dashboard/index.html`, { method: "PUT" }).then((r) => r.json());
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => (socket.onopen = resolve));

  let next = 0;
  const pending = new Map();
  const problems = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) pending.get(message.id)?.(message);
    else if (message.method === "Runtime.exceptionThrown") problems.push(message.params.exceptionDetails.exception?.description ?? "exception");
    else if (message.method === "Log.entryAdded" && message.params.entry.level === "error") problems.push(message.params.entry.text);
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(++next, resolve);
      socket.send(JSON.stringify({ id: next, method, params }));
    });

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.reload");
  await sleep(5000);

  const result = await send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(async () => ({
      version: document.getElementById("version").textContent,
      account: document.getElementById("account-status").textContent,
      start: document.getElementById("start").disabled ? "disabled" : "enabled",
      galleryPage: await fetch(chrome.runtime.getURL("gallery/gallery.html")).then((r) => r.text()).then((t) => t.includes("gallery-data.js"))
    }))()`,
    awaitPromise: true
  });
  const state = result.result.result.value;
  // SCREENSHOT=path.png saves a picture of the dashboard.
  if (process.env.SCREENSHOT) {
    await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    const shot = await send("Page.captureScreenshot", { format: "png" });
    (await import("node:fs")).writeFileSync(process.env.SCREENSHOT, Buffer.from(shot.result.data, "base64"));
  }
  console.log(state);

  if (!state.version.startsWith("v")) problems.push("version not shown");
  if (!state.galleryPage) problems.push("gallery page not readable from the extension");
  if (!state.account.includes("TikTok is not open")) problems.push(`unexpected account status: ${state.account}`);
  // The gallery opened by the extension, before any folder is chosen.
  const gallery = await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${id}/gallery/gallery.html`, { method: "PUT" }).then((r) => r.json());
  await sleep(2000);
  const galleryText = await new Promise((resolve) => {
    const ws = new WebSocket(gallery.webSocketDebuggerUrl);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: 'document.getElementById("empty").textContent', returnByValue: true } }));
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) {
        ws.close();
        resolve(message.result.result.value);
      }
    };
  });
  console.log({ gallery: galleryText });
  if (!galleryText.includes("No archive folder")) problems.push(`unexpected gallery message: ${galleryText}`);

  if (problems.length) {
    failed = true;
    console.error("Problems:", problems);
  } else {
    console.log("Dashboard loaded without errors.");
  }
} catch (err) {
  failed = true;
  console.error(err.message);
} finally {
  browser.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
