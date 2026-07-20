const MIB = 1024 * 1024;

const synchsafe = (value: number) =>
  Uint8Array.of((value >>> 21) & 0x7f, (value >>> 14) & 0x7f, (value >>> 7) & 0x7f, value & 0x7f);

const id3v24TextFrame = (id: string, value: string) => {
  const text = new TextEncoder().encode(value);
  const payload = new Uint8Array(1 + text.length);
  payload[0] = 3;
  payload.set(text, 1);
  const result = new Uint8Array(10 + payload.length);
  result.set(new TextEncoder().encode(id), 0);
  result.set(synchsafe(payload.length), 4);
  result.set(payload, 10);
  return result;
};

const makeTag = (seed: number) => {
  const frames = [
    id3v24TextFrame("TIT2", `Synthetic benchmark track ${seed}`),
    id3v24TextFrame("TPE1", "Tagium benchmark"),
    id3v24TextFrame("TALB", "Deterministic corpus"),
    id3v24TextFrame("TDRC", "2026"),
    id3v24TextFrame("TRCK", String(seed + 1)),
  ];
  const bodySize = frames.reduce((sum, frame) => sum + frame.length, 0);
  const tag = new Uint8Array(10 + bodySize);
  tag.set([0x49, 0x44, 0x33, 4, 0, 0], 0);
  tag.set(synchsafe(bodySize), 6);
  let offset = 10;
  for (const frame of frames) {
    tag.set(frame, offset);
    offset += frame.length;
  }
  return tag;
};

// MPEG-1 Layer III, 128 kbps, 44.1 kHz. A 417-byte frame is sufficient for
// both the old two-frame admission check and the new container-derived scan.
const makeAudioChunk = () => {
  const frame = new Uint8Array(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  const chunk = new Uint8Array(MIB);
  for (let offset = 0; offset + frame.length <= chunk.length; offset += frame.length) {
    chunk.set(frame, offset);
  }
  return chunk;
};

export const makeMp3Corpus = (files: number, bytesPerFile: number, seed: number): File[] => {
  const audioChunk = makeAudioChunk();
  return Array.from({ length: files }, (_, index) => {
    const tag = makeTag(seed + index);
    const parts: Array<Uint8Array<ArrayBuffer>> = [tag];
    let remaining = Math.max(834, bytesPerFile - tag.length);
    while (remaining > 0) {
      const length = Math.min(remaining, audioChunk.length);
      parts.push(length === audioChunk.length ? audioChunk : audioChunk.subarray(0, length));
      remaining -= length;
    }
    return new File(parts, `benchmark-${seed + index}.mp3`, {
      type: "audio/mpeg",
      lastModified: 1_700_000_000_000 + seed + index,
    });
  });
};
