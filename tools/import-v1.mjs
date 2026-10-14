// Moves videos saved by v1 of this extension into a new archive, where they
// are provably the same file the new version would download.
//
//   node tools/import-v1.mjs <v1 folder> <new archive folder>          (dry run)
//   node tools/import-v1.mjs <v1 folder> <new archive folder> --apply
//
// A v1 file is taken only when its size equals, to the byte, the size TikTok
// lists for the stream the new version picks, and ffprobe confirms the codec
// and dimensions. Everything else is left in place for the extension to
// download. Every move is logged to import-v1.log.json in the new archive.

import { readdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { planItem, MEDIA_DIR } from "../extension/lib/plan.js";

const [oldRoot, newRoot, flag] = process.argv.slice(2);
if (!oldRoot || !newRoot || (flag && flag !== "--apply")) {
  console.error("usage: node tools/import-v1.mjs <v1 folder> <new archive folder> [--apply]");
  process.exit(2);
}
const apply = flag === "--apply";

const oldMedia = join(oldRoot, "Likes");
const newItems = join(newRoot, "items");
const newMedia = join(newRoot, MEDIA_DIR);

// v1 named files <handle>_<id>_<codec>_<height>p.mp4.
const v1Files = new Map();
for (const name of readdirSync(oldMedia)) {
  const id = name.match(/_(\d{15,25})_[a-z0-9]+_\d+p\.mp4$/)?.[1];
  if (id) v1Files.set(id, name);
}

function probe(path) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", path], { encoding: "utf8" });
  const streams = JSON.parse(out).streams;
  const video = streams.find((s) => s.codec_type === "video");
  return { video, hasAudio: streams.some((s) => s.codec_type === "audio") };
}

const sameCodec = (codecType, codecName) =>
  /265|hvc|hevc|bytevc1/i.test(codecType) ? codecName === "hevc" : /264|avc/i.test(codecType) && codecName === "h264";

const outcome = { moved: [], skipped: {} };
const skip = (reason, id) => (outcome.skipped[reason] ??= []).push(id);

for (const file of readdirSync(newItems)) {
  const recordPath = join(newItems, file);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (record.media?.status === "saved") continue;

  const v1Name = v1Files.get(record.id);
  if (!v1Name) {
    skip("no v1 file", record.id);
    continue;
  }

  const plan = planItem(record.raw);
  const part = plan.parts?.[0];
  if (record.kind !== "video" || !part || part.role !== "video") {
    skip("not a video with a stream", record.id);
    continue;
  }

  const source = join(oldMedia, v1Name);
  const bytes = statSync(source).size;
  if (!part.expectedBytes || bytes !== part.expectedBytes) {
    skip("v1 saved a different stream", record.id);
    continue;
  }

  const { video, hasAudio } = probe(source);
  const { stream } = part;
  if (!video || !hasAudio || !sameCodec(stream.codecType, video.codec_name) || video.width !== stream.width || video.height !== stream.height) {
    skip("same size but contents differ", record.id);
    continue;
  }

  const target = join(newMedia, `${part.stem}.mp4`);
  if (existsSync(target)) {
    skip("target file already exists", record.id);
    continue;
  }

  outcome.moved.push({ id: record.id, from: source, to: target });
  if (!apply) continue;

  renameSync(source, target);
  record.media = {
    status: "saved",
    savedAt: new Date().toISOString(),
    files: [{ role: "video", file: `${MEDIA_DIR}/${part.stem}.mp4`, bytes, stream }],
    notes: ["imported_from_v1"]
  };
  writeFileSync(recordPath, JSON.stringify(record, null, 2));
}

if (apply) {
  writeFileSync(join(newRoot, "import-v1.log.json"), JSON.stringify({ at: new Date().toISOString(), ...outcome }, null, 2));
}

console.log(`${apply ? "Moved" : "Would move"} ${outcome.moved.length} files.`);
for (const [reason, ids] of Object.entries(outcome.skipped)) console.log(`Left alone, ${reason}: ${ids.length}`);
