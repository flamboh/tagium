import { describe, expect, it } from "vite-plus/test";
import audioTaggerSource from "./audioTagger.tsx?raw";

describe("audio backend import contract", () => {
  it("keeps audioTagger off Promise facade APIs", () => {
    expect(audioTaggerSource).not.toMatch(
      /\b(downloadCobaltAudio|parseUploadedTracks|writeMetadataToFile)\b/,
    );
  });
});
