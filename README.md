# Likes Archiver for TikTok

A Chromium extension that saves every TikTok video and photo post you have
liked into a folder on your computer.

- Saves videos in the best quality available, and photo posts with their sound.
- You can stop and continue at any time; later runs only get new likes.
- Includes a gallery page to browse your likes offline.

It only reads your likes, only talks to TikTok, and sends nothing anywhere
else.

## Install

1. Download the latest `likes-archiver-for-tiktok.zip` from
   [Releases](../../releases) and unzip it.
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder.

## Use

1. Open [tiktok.com](https://www.tiktok.com) in a tab and log in.
2. Click the extension's icon to open its page.
3. Choose a folder to save into.
4. Press **Download all my likes**.

- The first download can take a while. You can stop and continue later.
- **Get new likes** fetches only what you liked since last time.
- **Full check** goes through everything again to fill gaps and find removed
  likes. Run it now and then.
- **Open gallery**, or `gallery.html` in the folder, shows what is saved.

## The folder

```text
gallery.html    Open this to browse your likes
Likes/          The videos, photos and sounds
items/          Everything TikTok said about each liked item
```

## Develop

- Load `extension/` with **Load unpacked**. There is no build step.
- `npm test` runs the tests (Node's built-in runner, no dependencies).
- `node tools/smoke-test.mjs` loads the extension in headless Chromium and
  checks its page opens. It never contacts TikTok.
- [docs/DESIGN.md](docs/DESIGN.md) explains how it works and why.

## License

[MIT](LICENSE). Not affiliated with TikTok.
