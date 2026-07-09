import { describe, expect, it } from "vite-plus/test";
import {
  createDirtyMetadataPatch,
  getFileImportKey,
  getSubmittedAudioMetadata,
  getTagiumFileImportKey,
} from "./audioTagger";
import type { AudioMetadata } from "./types";

const metadata = (overrides: Partial<AudioMetadata> = {}): AudioMetadata => ({
  filename: "old-title",
  title: "Old Title",
  artist: "Artist",
  album: "Album",
  year: 2024,
  genre: "Genre",
  duration: 100,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: 7,
  ...overrides,
});

describe("audioTagger metadata patches", () => {
  it("keeps a lightweight source identity after releasing the original file", () => {
    const original = new File(["original"], "track.mp3", { lastModified: 123 });
    const edited = new File(["edited audio"], "renamed.mp3", { lastModified: 456 });
    const sourceImportKey = getFileImportKey(original);

    expect(
      getTagiumFileImportKey({
        id: "track",
        filename: edited.name,
        file: edited,
        originalFile: edited,
        sourceImportKey,
        status: "saved",
        downloadStatus: "ready",
      }),
    ).toBe(sourceImportKey);
  });

  it("creates title-only preview patches without stale numeric fields", () => {
    const patch = createDirtyMetadataPatch(
      metadata({ title: "New Title", year: 1999, trackNumber: 3 }),
      {},
      false,
      ["title"],
    );

    expect(patch).toEqual({ title: "New Title" });
  });

  it("syncs filename intent when title changes with filename sync enabled", () => {
    const patch = createDirtyMetadataPatch(
      metadata({ filename: "New-Title", title: "New Title", year: 1999, trackNumber: 3 }),
      {},
      true,
      ["title"],
    );

    expect(patch).toEqual({ filename: "New-Title", title: "New Title" });
  });

  it("derives synced filename from submitted title before creating download hydration patches", () => {
    const rawFormMetadata = metadata({ filename: "old-title", title: "New Title" });
    const submittedMetadata = getSubmittedAudioMetadata(rawFormMetadata, true);
    const patch = createDirtyMetadataPatch(submittedMetadata, { title: true }, true);

    expect(patch).toEqual({ filename: "New Title", title: "New Title" });
  });

  it("buffers only dirty form fields", () => {
    const patch = createDirtyMetadataPatch(
      metadata({
        title: "New Title",
        artist: "New Artist",
        year: 1999,
        trackNumber: 3,
      }),
      { title: true, artist: true },
      false,
    );

    expect(patch).toEqual({ title: "New Title", artist: "New Artist" });
  });

  it("creates null patches for dirty numeric fields cleared by RHF", () => {
    const patch = createDirtyMetadataPatch(
      metadata({
        year: Number.NaN,
        trackNumber: Number.NaN,
      }),
      { year: true, trackNumber: true },
      false,
    );

    expect(patch).toEqual({ year: null, trackNumber: null });
  });

  it("keeps cleared numeric form values absent when fields are untouched", () => {
    const patch = createDirtyMetadataPatch(
      metadata({
        title: "New Title",
        year: Number.NaN,
        trackNumber: Number.NaN,
      }),
      { title: true },
      false,
    );

    expect(patch).toEqual({ title: "New Title" });
  });
});
