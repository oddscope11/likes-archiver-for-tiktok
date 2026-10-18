# Design notes

How TikTok Likes Archiver works and why. For installing and using it, see the
[README](../README.md).

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
- **Gallery:** `gallery.html` in the archive folder, rewritten with its data
  after every run, however the run ended. It works opened straight from disk
  with no extension installed, and reads only `gallery-data.js` and the media
  files (a page opened from disk may not read `items/`). Thumbnails are each
  video's frame at 1 s, drawn locally; TikTok's cover links expire.
  `tools/build-gallery.mjs` rebuilds it without the extension. The dashboard's
  Open gallery button opens the same page inside the extension, reading the
  folder directly (the extension cannot open `file://` pages or learn the
  folder's path).
- **HEVC in the browser:** Chromium decodes HEVC only with hardware support.
  A desktop Chromium with hardware decoding plays it fine; headless Chromium
  usually cannot, so the headless tests see sound without picture. Where the browser
  reports no HEVC support, the gallery says to use a video player. HEVC stays
  preferred.
- **Browser:** Chromium only.

## Staying on TikTok's good side

During development the test account saw several captchas, always on the
TikTok tab while it was being used by hand; no run was ever interrupted by
one. They kept appearing on a day with no runs at all, so they seem tied to a
fresh browser and login rather than to the extension. Still, the first day
included about ten hand-made feed requests and a dozen refused downloads from
`curl`, which is what the first rule below is about.

Rules that follow from it:

- **Never probe TikTok outside the extension.** No `curl`, no headless browser,
  no hand-written requests through a logged-in session. TikTok is only
  contacted by real runs.
- **Pages of the likes feed are 5 to 9 seconds apart**, and downloads 1 to 2.5
  seconds apart.
- **A verification or refusal ends the run** with instructions for the user
  and a suggested time to wait. The extension never retries past one, but the
  user may start again whenever they choose.

The feed request carries the same parameters as the one TikTok's own Likes
tab sends, including `count=16`, except `video_encoding=dash` (see
Decisions). TikTok's page adds its signature (`msToken`, `X-Bogus`,
`X-Gnarly`) to it, as it does to its own requests.

Open questions:

- Whether the Origin/Referer rule for video downloads is needed.

## Archive folder format

```text
<archive>/
  archive.json      { format, createdAt, account, firstDownload, fullCheck,
                      lastFullCheckAt, topCheckedAt, likesCount, failures }
  gallery.html      A page to browse the archive; open it from the folder
  gallery-data.js   What the page shows, rebuilt from items/ after every run
  items/<id>.json   One record per liked item
  Likes/            The media files
    <handle>_<id>.mp4                 a video
    <handle>_<id>_01.jpg, _02.jpg…    a photo post's images, in order
    <handle>_<id>_audio.mp3           a photo post's audio (.mp3 or .m4a)
```


`firstDownload` is `{ complete, nextCursor, startedAt, completedAt }`. Until
the first download has walked the whole feed, `nextCursor` is the page it
continues from. `fullCheck` is `{ nextCursor, startedAt }` while a full check
is unfinished, and `likesCount` is how many likes the last walk from the top
to the end saw. `failures` maps each item that could not be saved to the cursor of the
page it was found on, so it can be retried with a single request.

How a run decides what to fetch:

- **First download not started:** walk the whole feed from the newest like,
  saving the position after every page.
- **First download interrupted:** walk from the newest like until a page holds
  nothing new, then continue the first download from `nextCursor`.
- **First download complete:** walk from the newest like until a page holds
  nothing new.
- **Full check** (its own button, once the first download is complete): walk
  the whole feed again, saving the position like the first download. An
  interrupted one is continued by the next Start, after a look for new likes.
- **Then:** retry up to five pages holding earlier failures.

"New" means not yet seen when the last complete check of the top of the feed
began (`topCheckedAt`). Items first seen by an interrupted walk still count as
new, so the next run walks past them rather than stopping on a page it only
half finished.

Removals are not stored; they follow from `seenAt`. Once a walk through the
whole feed completes (the first download or a full check), an item it did not
see is no longer in the likes: deleted, made private or unliked.
`lastFullCheckAt` is when that walk started, and an item seen after it is
back. Archives from before `startedAt` was recorded count from `createdAt`.

Before walking, a run reads every record and checks its files are on disk.
Items with missing files, or that a stopped run never tried, join `failures`
and are fetched again through their page. Items with no known page are
reported instead.

After TikTok pushes back (an error, a refusal or a verification), the
dashboard suggests waiting an hour, doubling with each further pushback that
day, up to eight hours. It is advice only: Start is never disabled, because
the user decides when to try again.

Items moved over from the extension's unpublished first version keep what
that version knew about them in a `legacy` field; their `raw` holds the few
TikTok fields it had saved.

Each item record holds:

- `id`, `kind` (`video`, `photo` or `unknown`)
- `firstSeenAt`, and `seenAt`: every scan that found the item in the feed
- `feedWindow`: the page cursors around the item when first seen. Cursors look
  like millisecond timestamps of the like, so they bracket when it was liked.
- `media`: `null` until a download is attempted, then either
  `{ status: "saved", savedAt, files: [{ role, file, bytes, stream }], notes }`
  or `{ status: "failed", at, reason, part, detail }`. Failed items are retried on
  the next run.
- `raw`: the item exactly as TikTok returned it on the latest scan

## Layout

```text
extension/            The unpacked extension (load this folder)
  manifest.json
  background.js       Service worker: opens the dashboard
  gallery/            The gallery page (gallery.html, gallery.js), copied
                      into each archive with its script inlined; source.js
                      feeds it from the folder when the extension opens it
  dashboard/          The extension's page: UI and run logic (index.js),
                      TikTok tab access (tiktok.js), folder access (folder.js),
                      streaming downloads (download.js), the latest-likes
                      strip (latest.js)
  lib/                Pure logic, covered by tests: feed walking, records,
                      stream selection, download plans, file sniffing,
                      run planning and suggested waits, retries
test/                 Node tests (`npm test`)
  fixtures/           Sanitized real API items; `raw/` is git-ignored
tools/
  smoke-test.mjs      Loads the extension in headless Chromium, checks the
                      dashboard opens (no TikTok requests)
package.json          npm test; npm run package zips the committed extension/
                      folder for a release
  build-gallery.mjs   Rebuilds an archive's gallery page from its records
```

## Status

Working end to end: the first download, resuming, update runs that stop at
the first page with nothing new, failure retries, photo posts (with and
without audio) and the gallery.

Not yet seen working live: the verification/captcha handling, the suggested
wait, switching to another TikTok tab when the one in use closes, and a
failure being retried through its page.

Next:

1. Maybe a Chrome Web Store listing (needs a name not starting with "TikTok"
   and a privacy policy).
