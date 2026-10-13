# TikTok Likes Archiver

A Chromium extension that archives your liked TikTok videos to a local folder.
This is a rewrite; the original version lives in `references/v1/`.

## Principles

1. **The archive is the product; the extension is replaceable.** The folder must
   make sense with no extension installed: plain media files, an open metadata
   format, and the raw record TikTok returned for each item.
2. **Never misreport what was saved.** Every liked item ends as saved, skipped
   with a reason, or failed with a reason. No silent fallbacks.
3. **Keep TikTok's bytes untouched where possible.** Remux only when the best
   stream has no audio. Never re-encode.
4. **Losing power at any moment costs one item at most.** State is written after
   every item, and re-running is always safe.
5. **Be a polite guest on the account.** Read-only requests, a low request rate,
   and a full stop at the first sign of rate limiting or a captcha. Normal
   TikTok browsing is never altered.
6. **Ask for the least trust possible.** Fewest permissions, no traffic except
   to TikTok, no telemetry, and creator-supplied text always escaped.
7. **Expect TikTok to change, and fail clearly when it does.** Detect unexpected
   response shapes and say so. Keep the logic small and tested against recorded
   responses.

## Decisions

- **Audience:** a non-technical person. The folder is remembered, errors are in
  plain language with a next step, and there are no settings to understand.
- **Scope:** liked items only, videos and photo posts.
- **Quality:** highest resolution, then HEVC over H.264, then highest bitrate.
  `bytevc2` (VVC) streams are skipped.
- **No muxing for now:** the feed is requested without `video_encoding=dash`, so
  every stream already includes audio and files are saved exactly as served.
  Dash offers long videos (over about 60 s) at a higher bitrate, but as
  video-only streams that need a local remux. Every offered stream is kept in
  the raw record, so this can be revisited.
- **Photo posts:** saved as the original images in order plus the audio track,
  not rendered into a video.
- **Metadata:** keep everything TikTok returns, including each time an item was
  seen online.
- **Gallery:** a separate consumer of the archive folder, not part of the
  extension. The folder format is the contract between them.
- **Browser:** Chromium only.

## Archive folder format

```text
<archive>/
  archive.json      { format, createdAt, account, lastCompleteScanAt }
  items/<id>.json   One record per liked item
```

Each item record holds:

- `id`, `kind` (`video`, `photo` or `unknown`)
- `firstSeenAt`, and `seenAt`: every scan that found the item in the feed
- `feedWindow`: the page cursors around the item when first seen. Cursors look
  like millisecond timestamps of the like, so they bracket when it was liked.
- `media`: what has been saved for the item (`null` until downloaded)
- `raw`: the item exactly as TikTok returned it on the latest scan

## Layout

```text
extension/          The unpacked extension (load this folder)
  manifest.json
  background.js     Service worker: opens the dashboard
  dashboard/        The extension's UI page
  lib/              Pure logic with no browser APIs, covered by tests
test/               Node tests (`npm test`)
  fixtures/         Sanitized API responses; `raw/` is git-ignored
references/         Background material, not shipped
  EXTRACTION_GUIDE.md
  v1/               The first version of this extension
  myfavett/, yt-dlp/  Third-party code, git-ignored
```

## Develop

- Load: `chrome://extensions` → Developer mode → Load unpacked → `extension/`
- Test: `npm test` (Node's built-in runner, no dependencies)

There is no build step: the extension is plain ES modules.
