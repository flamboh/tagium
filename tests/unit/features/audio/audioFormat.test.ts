import { describe, expect, it } from "vite-plus/test";
import {
  getAudioFormatInfo,
  getAudioUploadAccept,
  normalizeAudioFilename,
  withAudioExtension,
  withoutAudioExtension,
} from "@/features/audio/audioFormat";

describe("audio format helpers", () => {
  it("centralizes the MP3 extension, MIME type, and upload admission hint", () => {
    expect(getAudioFormatInfo("mp3")).toEqual({
      id: "mp3",
      extension: ".mp3",
      mimeType: "audio/mpeg",
    });
    expect(getAudioUploadAccept()).toBe(".mp3,audio/mpeg");
  });

  it("joins and removes the authoritative extension without changing filename casing", () => {
    expect(withAudioExtension("Artist - Track", "mp3")).toBe("Artist - Track.mp3");
    expect(withAudioExtension("Artist - Track.MP3", "mp3")).toBe("Artist - Track.MP3");
    expect(withoutAudioExtension("Artist - Track.MP3", "mp3")).toBe("Artist - Track");
  });

  it("replaces a misleading extension while preserving already-correct filenames", () => {
    expect(normalizeAudioFilename("Artist - Track.wav", "mp3")).toBe("Artist - Track.mp3");
    expect(normalizeAudioFilename("Artist - Track.MP3", "mp3")).toBe("Artist - Track.MP3");
  });
});
