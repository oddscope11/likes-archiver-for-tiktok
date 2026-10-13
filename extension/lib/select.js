// Chooses which of the streams TikTok offers for a video to save.

// ByteDance's VVC streams do not play in ordinary players.
const isUnplayable = (codecType) => /bytevc2|vvc|266/i.test(codecType);
const isHevc = (codecType) => /bytevc1|hevc|hvc|265/i.test(codecType);

function fromGear(gear) {
  const addr = gear.PlayAddr ?? {};
  return {
    gearName: gear.GearName ?? "",
    codecType: gear.CodecType ?? "",
    width: Number(addr.Width) || 0,
    height: Number(addr.Height) || 0,
    bitrate: Number(gear.Bitrate) || 0,
    bytes: Number(addr.DataSize) || 0,
    urls: (addr.UrlList ?? []).filter((url) => typeof url === "string" && url.startsWith("https://"))
  };
}

// Returns the usable streams, best first: most pixels, then HEVC over H.264,
// then highest bitrate. Empty when the item offers nothing usable.
export function rankStreams(item) {
  const video = item.video ?? {};

  const streams = (video.bitrateInfo ?? [])
    .map(fromGear)
    .filter((stream) => stream.urls.length > 0 && !isUnplayable(stream.codecType));

  // Items without a stream list still carry one default stream.
  if (streams.length === 0 && typeof video.playAddr === "string" && video.playAddr.startsWith("https://")) {
    streams.push({
      gearName: "default",
      codecType: video.codecType ?? "",
      width: Number(video.width) || 0,
      height: Number(video.height) || 0,
      bitrate: Number(video.bitrate) || 0,
      bytes: 0,
      urls: [video.playAddr]
    });
  }

  return streams.sort(
    (a, b) =>
      b.width * b.height - a.width * a.height ||
      Number(isHevc(b.codecType)) - Number(isHevc(a.codecType)) ||
      b.bitrate - a.bitrate
  );
}
