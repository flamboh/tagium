import EncodeLibAV from "@imput/libav.js-encode-cli";
import type { AudioFormatKind } from "@/features/audio/metadataEngine/types";

export type AudioClipRequest = {
  file: File;
  kind: AudioFormatKind;
  start: number;
  end: number;
};

export type AudioClipMessage = { blob: Blob } | { error: string };

const inputName = "tagium-clip-input";
const outputName = "tagium-clip-output";

const muxers = {
  mp3: "mp3",
  flac: "flac",
  m4a: "ipod",
  opus: "opus",
} as const satisfies Record<AudioFormatKind, string>;

/**
 * Lossy formats are stream copied so the clip stays lossless; cuts land on the nearest packet
 * boundary (tens of milliseconds). FLAC is re-encoded instead, which is still lossless and
 * rebuilds STREAMINFO, whose sample count stream copy would leave at the source length.
 * Artwork streams are dropped because the caller rewrites tags afterwards.
 */
export const makeAudioClipArgs = (request: Omit<AudioClipRequest, "file">) => [
  "-nostdin",
  "-y",
  "-loglevel",
  "error",
  "-i",
  inputName,
  "-ss",
  request.start.toFixed(3),
  "-to",
  request.end.toFixed(3),
  "-map",
  "0:a:0",
  "-map_metadata",
  "0",
  "-c:a",
  request.kind === "flac" ? "flac" : "copy",
  "-avoid_negative_ts",
  "make_zero",
  "-f",
  muxers[request.kind],
  outputName,
];

const clipAudio = async (request: AudioClipRequest) => {
  const libav = await EncodeLibAV.LibAV({ base: "/_libav", noworker: true });
  const patches: Array<{ position: number; data: Uint8Array }> = [];
  let size = 0;
  libav.onwrite = (name, position, data) => {
    if (name !== outputName) return;
    const patch = Uint8Array.from(new Uint8Array(data));
    size = Math.max(size, position + patch.length);
    patches.push({ position, data: patch });
  };

  try {
    await libav.mkreadaheadfile(inputName, request.file);
    await libav.mkwriterdev(outputName);
    await libav.ffmpeg(makeAudioClipArgs(request));
    if (size === 0) throw new Error("clipping produced an empty file.");
    const bytes = new Uint8Array(size);
    for (const patch of patches) bytes.set(patch.data, patch.position);
    return new Blob([bytes], { type: request.file.type });
  } finally {
    await Promise.allSettled([libav.unlink(outputName), libav.unlinkreadaheadfile(inputName)]);
    libav.terminate();
  }
};

if (globalThis.self) {
  globalThis.self.onmessage = async (event: MessageEvent<AudioClipRequest>) => {
    let message: AudioClipMessage;
    try {
      message = { blob: await clipAudio(event.data) };
    } catch (error) {
      message = { error: error instanceof Error ? error.message : "audio clipping failed." };
    }
    globalThis.self.postMessage(message);
  };
}
