# TikTok Likes Archiver

A Chromium extension that saves every TikTok video and photo post you have
liked into a folder on your computer, and gives you a page to browse them.

- **Best quality TikTok offers:** the highest resolution, saved exactly as
  TikTok serves it, never re-encoded.
- **Photo posts too:** the original images in order, plus their sound.
- **Picks up where it left off:** the first download can be stopped and
  continued at any time. After that, each run only fetches what you have liked
  since.
- **Everything about each like is kept:** the caption, creator, dates and the
  full details TikTok returned, as plain JSON next to the media files.
- **A gallery that needs nothing installed:** `gallery.html` in the folder
  opens in any browser and lets you search and watch your likes.
- **Private:** it talks only to TikTok, through your own logged-in tab. No
  accounts, no tracking, no servers of its own.

## Install

The extension is not in the Chrome Web Store. To install it:

1. Download the latest `tiktok-likes-archiver.zip` from
   [Releases](../../releases) and unzip it.
2. Open `chrome://extensions` in Chrome, Chromium or another Chromium-based
   browser.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder.

## Use

1. Open [tiktok.com](https://www.tiktok.com) in a tab and log in.
2. Click the extension's icon to open its page.
3. Choose a folder to save into. The extension remembers it.
4. Press **Download all my likes**.

The first download walks through all your likes, a few seconds per page, so
it can take a while if you have many. You can stop at any time; the button
then says **Continue download** and picks up where it stopped. After that it
says **Get new likes**, which only fetches what you have liked since and
usually finishes in seconds.

Once the first download is done, **Full check** goes through all your likes
again. It fetches anything missing from the folder, and marks the items that
are no longer in your likes (deleted, made private or unliked); the gallery
can show just those. It takes as long as a first download, so run it now and
then, not every time.

Press **Open gallery** to browse what is saved, or open `gallery.html` in the
folder.

If TikTok shows a verification puzzle or refuses requests, the run stops and
says so. Complete the puzzle on the TikTok tab and wait a while before
starting again.

## What ends up in the folder

```text
gallery.html        Open this to browse your likes
gallery-data.js     What the gallery shows
archive.json        Which account this is, and how far the download got
items/<id>.json     Everything TikTok said about each liked item
Likes/              The videos, photos and sounds
```

The folder is the archive: it stays useful without the extension.

## Privacy

The extension only makes requests to TikTok, using the TikTok tab you have
open, and only reads your likes. It never posts, likes, follows or changes
anything on your account. Nothing is sent anywhere else. Its permissions are
limited to `tiktok.com` and TikTok's video servers.

## Develop

- Load `extension/` with **Load unpacked**. There is no build step.
- `npm test` runs the tests (Node's built-in runner, no dependencies).
- `node tools/smoke-test.mjs` loads the extension in headless Chromium and
  checks its page opens. It never contacts TikTok.
- [docs/DESIGN.md](docs/DESIGN.md) explains how it works and why.

## License

[MIT](LICENSE). Not affiliated with TikTok.
