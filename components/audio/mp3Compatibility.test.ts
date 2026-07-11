import { describe, expect, it } from "vite-plus/test";
import {
  getMp3AdmissionError,
  isMp3Bytes,
  MP3_MIME_TYPE,
  normalizeMp3File,
} from "./mp3Compatibility";
import { validFreeFormatMp3Bytes, validMp3Bytes } from "./mp3TestFixtures";

describe("MP3 compatibility", () => {
  it("accepts MP3 frame contents when browser MIME metadata is missing or inconsistent", () => {
    const bytes = validMp3Bytes();
    expect(isMp3Bytes(bytes)).toBe(true);
    expect(
      getMp3AdmissionError(new File([bytes], "track.mp3", { type: "audio/wav" }), bytes),
    ).toBeNull();
  });

  it("rejects a single complete frame ending at EOF", () => {
    expect(isMp3Bytes(validMp3Bytes().slice(0, 417))).toBe(false);
  });

  it("rejects a truncated second frame", () => {
    expect(isMp3Bytes(validMp3Bytes().slice(0, 500))).toBe(false);
  });

  it("rejects incompatible and payload-like second headers", () => {
    const incompatible = validMp3Bytes();
    incompatible.set([0xff, 0xf3, 0x90, 0x00], 417);
    expect(isMp3Bytes(incompatible)).toBe(false);

    const falseHeader = validMp3Bytes().slice(0, 500);
    falseHeader.set([0xff, 0xfb, 0x90, 0x00], 417);
    expect(isMp3Bytes(falseHeader)).toBe(false);
  });

  it("accepts synchronized complete free-format MP3 frames", () => {
    expect(isMp3Bytes(validFreeFormatMp3Bytes())).toBe(true);
  });

  it("rejects a WAV container even when its payload contains valid MP3 frames", () => {
    const bytes = new Uint8Array(12 + validMp3Bytes().length);
    bytes.set(new TextEncoder().encode("RIFF0000WAVE"));
    bytes.set(validMp3Bytes(), 12);
    const file = new File([bytes], "wrapped.wav", { type: "audio/wav" });

    expect(getMp3AdmissionError(file, bytes)).toBe(
      "wrapped.wav is not an MP3. Tagium currently supports MP3 files only.",
    );
  });

  it("rejects truncated or irregular free-format synchronization", () => {
    expect(isMp3Bytes(validFreeFormatMp3Bytes().slice(0, 750))).toBe(false);
    const irregular = validFreeFormatMp3Bytes();
    irregular.copyWithin(650, 600, 604);
    irregular.fill(0, 600, 604);
    expect(isMp3Bytes(irregular)).toBe(false);
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

  it("normalizes an admitted file's MIME type", () => {
    const file = normalizeMp3File(new File([validMp3Bytes()], "track.mp3", { type: "audio/wav" }));
    expect(file.name).toBe("track.mp3");
    expect(file.type).toBe(MP3_MIME_TYPE);
  });
});
