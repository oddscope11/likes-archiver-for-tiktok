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

## Staying on TikTok's good side

On 2026-10-13, the first day of development, TikTok showed the test account
two captchas. Both appeared on the TikTok tab while it was being used by hand;
no run of the extension was interrupted, so its verification handling has not
yet been seen working live. As best remembered, the first came before the
extension's first scan, which leaves only causes 1 and 2 below for that one,
and the second came after scanning had started. The cause was not established.
What happened that day, most likely first:

1. A freshly installed browser with a new login.
2. Ad-hoc exploration: about ten likes-feed requests in a few minutes through
   the logged-in session, with varying parameters, plus partial-file requests.
3. Feed requests that carry seven parameters where TikTok's own page sends
   several dozen.
4. Volume: a 27-page scan in two minutes, then several more runs.
5. A dozen refused requests to TikTok's video servers from the same IP address
   (`curl` and a logged-out headless browser).

On 2026-10-14 three more captchas appeared, again only on the tab being used
by hand; no run was interrupted by one. That day's runs were two long
walks with the old code (the second read 568 items before TikTok answered
with error 100001), then two short runs with the resumable walk. On 2026-10-15, with no extension runs
since the day before, a few minutes of normal use brought three captchas, each
while opening a user profile. So captchas appear without the extension; they
are more likely tied to the new browser and login, or to the account.

Rules that follow from it:

- **Never probe TikTok outside the extension.** No `curl`, no headless browser,
  no hand-written requests through a logged-in session. Download code is
  tested against a local server; TikTok is only contacted by real runs.
- **Pages of the likes feed are 5 to 9 seconds apart**, and downloads 1 to 2.5
  seconds apart.
- **A verification or refusal ends the run** with instructions for the user
  and a suggested time to wait. The extension never retries past one, but the
  user may start again whenever they choose.

Still to do:

- The feed request now carries the same parameters as the one TikTok's own
  Likes tab sends (observed 2026-10-14), including `count=16`, except
  `video_encoding=dash` (see Decisions). Not yet confirmed: that TikTok's page
  adds its signature (msToken, X-Bogus, X-Gnarly) to our requests too. Check by
  reading the TikTok tab's network log during a run.
- Routine runs now stop at the first page with nothing new, so `seenAt` is no
  longer refreshed for older likes. An occasional full check could restore
  that if tracking vanished items becomes a priority.
- Find out whether the Origin/Referer rule for video downloads is needed.

## Archive folder format

```text
<archive>/
  archive.json      { format, createdAt, account, firstDownload, failures }
  items/<id>.json   One record per liked item
  Likes/            The media files
    <handle>_<id>.mp4                 a video
    <handle>_<id>_01.jpg, _02.jpg…    a photo post's images, in order
    <handle>_<id>_audio.mp3           a photo post's audio (.mp3 or .m4a)
```


`firstDownload` is `{ complete, nextCursor, completedAt }`. Until the first
download has walked the whole feed, `nextCursor` is the page it continues
from. `failures` maps each item that could not be saved to the cursor of the
page it was found on, so it can be retried with a single request.

How a run decides what to fetch:

- **First download not started:** walk the whole feed from the newest like,
  saving the position after every page.
- **First download interrupted:** walk from the newest like until a page holds
  nothing new, then continue the first download from `nextCursor`.
- **First download complete:** walk from the newest like until a page holds
  nothing new.
- **Then:** retry up to five pages holding earlier failures.

After TikTok pushes back (an error, a refusal or a verification), the
dashboard suggests waiting an hour, doubling with each further pushback that
day, up to eight hours. It is advice only: Start is never disabled, because
the user decides when to try again.

Items brought in by `tools/import-v1.mjs` that the feed no longer lists have
`raw: null` and a `legacy` field holding what v1 knew about them.

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
  dashboard/          The extension's page: UI and run logic (index.js),
                      TikTok tab access (tiktok.js), folder access (folder.js),
                      streaming downloads (download.js)
  lib/                Pure logic, covered by tests: feed walking, records,
                      stream selection, download plans, file sniffing,
                      run planning and suggested waits, retries
test/                 Node tests (`npm test`)
  fixtures/           Sanitized real API items; `raw/` is git-ignored
tools/
  smoke-test.mjs      Loads the extension in headless Chromium, checks the
                      dashboard opens (no TikTok requests)
  import-v1.mjs       One-off migration of a v1 archive (done for the
                      author's archive on 2026-10-14)
references/           Background material, not shipped
  EXTRACTION_GUIDE.md
  v1/                 The first version of this extension
  myfavett/, yt-dlp/  Third-party code, git-ignored
```

## Develop

- Load: `chrome://extensions` → Developer mode → Load unpacked → `extension/`
- Test: `npm test` (Node's built-in runner, no dependencies)

There is no build step: the extension is plain ES modules.

## Status (2026-10-14)

Working end to end on the author's account: the first download, resuming,
update runs that stop at the first page with nothing new, failure retries,
photo posts (with and without audio) and the v1 migration. The author's
archive is `~/Videos/tiktok4` (780 items, all saved); the v1 archive has been
deleted.

Not yet seen working live: the verification/captcha handling, the suggested
wait, switching to another TikTok tab when the one in use closes, and a
failure being retried through its page.

Next steps, in order:

1. Lower the captcha risk: confirm our feed requests are signed like the
   page's own, decide on `video_encoding=dash`, and find out whether the
   Origin/Referer rule is needed.
2. The gallery: a separate page that reads the archive folder. Records with
   `raw: null` (imported from v1) carry their details in `legacy` instead.
3. Prepare for a non-technical user: a more polished dashboard, setup help,
   and eventually a Chrome Web Store listing.

Compare against v1 and myfaveTT at the end of each milestone. Currently ahead
on quality choice, photo posts, honest failure reporting, crash safety,
permissions and request volume; behind on having a viewer.

