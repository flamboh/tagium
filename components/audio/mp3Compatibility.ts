export const MP3_MIME_TYPE = "audio/mpeg";

const bitrateKbps = {
  mpeg1Layer1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  mpeg1Layer2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  mpeg1Layer3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  mpeg2Layer1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  mpeg2Layer23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
} as const;

interface FrameHeader {
  versionBits: number;
  layer: number;
  sampleRate: number;
  bitrateIndex: number;
  frameLength: number | null;
}

const getFrameHeader = (bytes: Uint8Array, offset: number): FrameHeader | null => {
  if (offset + 4 > bytes.length || bytes[offset] !== 0xff || (bytes[offset + 1]! & 0xe0) !== 0xe0) {
    return null;
  }

  const versionBits = (bytes[offset + 1]! >> 3) & 0x03;
  const layerBits = (bytes[offset + 1]! >> 1) & 0x03;
  const bitrateIndex = (bytes[offset + 2]! >> 4) & 0x0f;
  const sampleRateIndex = (bytes[offset + 2]! >> 2) & 0x03;
  const padding = (bytes[offset + 2]! >> 1) & 0x01;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 15 || sampleRateIndex === 3) {
    return null;
  }

  const isMpeg1 = versionBits === 3;
  const layer = 4 - layerBits;
  const divisor = isMpeg1 ? 1 : versionBits === 2 ? 2 : 4;
  const sampleRate = [44_100, 48_000, 32_000][sampleRateIndex]! / divisor;
  if (bitrateIndex === 0) {
    return { versionBits, layer, sampleRate, bitrateIndex, frameLength: null };
  }

  const table = isMpeg1
    ? layer === 1
      ? bitrateKbps.mpeg1Layer1
      : layer === 2
        ? bitrateKbps.mpeg1Layer2
        : bitrateKbps.mpeg1Layer3
    : layer === 1
      ? bitrateKbps.mpeg2Layer1
      : bitrateKbps.mpeg2Layer23;
  const bitrate = table[bitrateIndex]! * 1_000;
  const frameLength =
    layer === 1
      ? Math.floor(((12 * bitrate) / sampleRate + padding) * 4)
      : Math.floor(((layer === 3 && !isMpeg1 ? 72 : 144) * bitrate) / sampleRate + padding);
  return { versionBits, layer, sampleRate, bitrateIndex, frameLength };
};

const headersAreCompatible = (first: FrameHeader, next: FrameHeader) =>
  first.versionBits === next.versionBits &&
  first.layer === next.layer &&
  first.sampleRate === next.sampleRate &&
  (first.bitrateIndex === 0) === (next.bitrateIndex === 0);

const hasCompleteKnownLengthFrames = (bytes: Uint8Array, offset: number, first: FrameHeader) => {
  if (first.frameLength === null || offset + first.frameLength > bytes.length) return false;
  const nextOffset = offset + first.frameLength;
  const next = getFrameHeader(bytes, nextOffset);
  return (
    next !== null &&
    next.frameLength !== null &&
    headersAreCompatible(first, next) &&
    nextOffset + next.frameLength <= bytes.length
  );
};

const hasCompleteFreeFormatFrames = (bytes: Uint8Array, offset: number, first: FrameHeader) => {
  // Free-format headers omit bitrate, so infer frame size from repeated, equally spaced syncs.
  // Requiring three complete frames avoids treating payload bytes or truncated data as evidence.
  const searchEnd = Math.min(bytes.length - 4, offset + 16_384);
  for (let secondOffset = offset + 4; secondOffset <= searchEnd; secondOffset++) {
    const second = getFrameHeader(bytes, secondOffset);
    if (!second || !headersAreCompatible(first, second)) continue;
    const spacing = secondOffset - offset;
    const thirdOffset = secondOffset + spacing;
    const third = getFrameHeader(bytes, thirdOffset);
    if (third && headersAreCompatible(first, third) && thirdOffset + spacing <= bytes.length) {
      return true;
    }
  }
  return false;
};

const getAudioStart = (bytes: Uint8Array) => {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;
  if ([bytes[6], bytes[7], bytes[8], bytes[9]].some((value) => (value! & 0x80) !== 0)) return -1;
  const tagSize = (bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!;
  return 10 + tagSize + ((bytes[5]! & 0x10) !== 0 ? 10 : 0);
};

export const isMp3Bytes = (bytes: Uint8Array) => {
  const audioStart = getAudioStart(bytes);
  if (audioStart < 0 || audioStart >= bytes.length) return false;
  const scanEnd = Math.min(bytes.length - 4, audioStart + 16_384);

  for (let offset = audioStart; offset <= scanEnd; offset++) {
    const first = getFrameHeader(bytes, offset);
    if (!first) continue;
    if (
      (first.frameLength === null && hasCompleteFreeFormatFrames(bytes, offset, first)) ||
      hasCompleteKnownLengthFrames(bytes, offset, first)
    ) {
      return true;
    }
  }
  return false;
};

const startsWithAscii = (bytes: Uint8Array, value: string, offset = 0) =>
  Array.from(value).every((character, index) => bytes[offset + index] === character.charCodeAt(0));

export const getMp3AdmissionError = (file: File, bytes: Uint8Array) => {
  if (bytes.length === 0) return `${file.name} is empty. Choose a valid MP3 file.`;
  if (isMp3Bytes(bytes)) return null;

  const knownUnsupported =
    startsWithAscii(bytes, "RIFF") ||
    startsWithAscii(bytes, "fLaC") ||
    startsWithAscii(bytes, "OggS") ||
    startsWithAscii(bytes, "ftyp", 4);
  if (knownUnsupported || (!/\.mp3$/i.test(file.name) && file.type !== MP3_MIME_TYPE)) {
    return `${file.name} is not an MP3. Tagium currently supports MP3 files only.`;
  }
  return `${file.name} is not a valid MP3. The file may be corrupt or renamed.`;
};

export const normalizeMp3Filename = (filename: string) => {
  const basename = filename.replace(/\.[^.]+$/, "") || "track";
  return `${basename}.mp3`;
};

export const normalizeMp3File = (file: File) =>
  file.type === MP3_MIME_TYPE && /\.mp3$/i.test(file.name)
    ? file
    : new File([file], normalizeMp3Filename(file.name), {
        type: MP3_MIME_TYPE,
        lastModified: file.lastModified,
      });
