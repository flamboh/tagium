import { describe, expect, it } from "vite-plus/test";
import {
  getMp3AdmissionError,
  isMp3Bytes,
  MP3_MIME_TYPE,
  normalizeMp3File,
} from "./mp3Compatibility";

const mp3Bytes = () => {
  const bytes = new Uint8Array(834);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 417);
  return bytes;
};

describe("MP3 compatibility", () => {
  it("accepts MP3 frame contents when browser metadata is missing or inconsistent", () => {
    const bytes = mp3Bytes();
    expect(isMp3Bytes(bytes)).toBe(true);
    expect(getMp3AdmissionError(new File([bytes], "track.bin"), bytes)).toBeNull();
  });

  it.each([
    ["empty", new Uint8Array(), "is empty"],
    ["renamed WAV", new TextEncoder().encode("RIFF0000WAVEdata"), "is not an MP3"],
    ["corrupt MP3", new TextEncoder().encode("not audio"), "is not a valid MP3"],
    ["unsupported audio", new TextEncoder().encode("fLaC0000"), "is not an MP3"],
  ])("rejects %s with an actionable error", (_case, bytes, message) => {
    const file = new File([bytes], "track.mp3", { type: MP3_MIME_TYPE });
    expect(getMp3AdmissionError(file, bytes)).toContain(message);
  });

  it("normalizes an admitted file's extension and MIME type", () => {
    const file = normalizeMp3File(new File([mp3Bytes()], "track.wav", { type: "audio/wav" }));
    expect(file.name).toBe("track.mp3");
    expect(file.type).toBe(MP3_MIME_TYPE);
  });
});
