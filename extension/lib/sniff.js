// Identifies a media file from its first bytes. TikTok's Content-Type headers
// are unreliable (an MP3 can arrive labelled video/mp4), and anything that is
// not real media, such as an HTML error page, must not be saved as if it were.

const startsWith = (bytes, signature, offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte);

const ascii = (text) => [...text].map((char) => char.charCodeAt(0));

function detect(bytes) {
  if (startsWith(bytes, ascii("ftyp"), 4)) return "mp4";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(bytes, [0x89, ...ascii("PNG")])) return "png";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "webp";
  // MP3: an ID3 tag, or a bare MPEG audio frame header.
  if (startsWith(bytes, ascii("ID3"))) return "mp3";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "mp3";
  return null;
}

const ALLOWED = {
  video: { mp4: "mp4" },
  image: { jpg: "jpg", png: "png", webp: "webp" },
  // A sound in an MP4 container is conventionally named .m4a.
  audio: { mp3: "mp3", mp4: "m4a" }
};

// Bytes needed from the start of a file to identify it.
export const SNIFF_BYTES = 12;

// Returns the file extension for these bytes when they are a format expected
// for `role` ("video", "image" or "audio"), otherwise null.
export function sniffExtension(bytes, role) {
  return ALLOWED[role]?.[detect(bytes)] ?? null;
}
