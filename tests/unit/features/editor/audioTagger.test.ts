import { describe, expect, it } from "vite-plus/test";
import {
  createDirtyMetadataPatch,
  getAcceptedUploadParseResult,
  getUploadRejectionMessage,
  getFileImportKey,
  getSubmittedAudioMetadata,
  getTagiumFileImportKey,
  getTrackSourceMix,
} from "@/features/editor/audioTaggerUtils";
import type { AudioMetadata } from "@/features/library/types";
import type { UploadedTrack } from "@/features/audio/mp3Utils";

const metadata = (overrides: Partial<AudioMetadata> = {}): AudioMetadata => ({
  filename: "old-title",
  title: "Old Title",
  artist: "Artist",
  albumArtist: "Artist",
  album: "Album",
  year: 2024,
  genre: "Genre",
  duration: 100,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: 7,
  composer: "",
  comment: "",
  discNumber: null,
  bpm: null,
  ...overrides,
});

describe("audioTagger metadata patches", () => {
  it("rejects parser error records instead of accepting them into the library", () => {
    const accepted = {
      file: {
        id: "accepted",
        filename: "accepted.mp3",
        status: "pending",
        downloadStatus: "ready",
      },
      albumSeed: { title: "", artist: "", genre: "" },
    } satisfies UploadedTrack;
    const rejected = {
      file: {
        id: "rejected",
        filename: "rejected.mp3",
        status: "error",
        downloadStatus: "ready",
        downloadError: "unable to parse audio metadata.",
      },
      albumSeed: { title: "", artist: "", genre: "" },
    } satisfies UploadedTrack;

    expect(getAcceptedUploadParseResult([accepted, rejected])).toEqual({
      acceptedUploads: [accepted],
      parseRejectedCount: 1,
    });
  });

  it("consolidates every rejected file error into one presentation", () => {
    const rejectedUploads = ["empty.mp3 is empty.", "song.wav is not an mp3."].map(
      (downloadError, index) =>
        ({
          file: {
            id: `rejected-${index}`,
            filename: index === 0 ? "empty.mp3" : "song.wav",
            status: "error",
            downloadStatus: "ready",
            downloadError,
          },
          albumSeed: { title: "", artist: "", genre: "" },
        }) satisfies UploadedTrack,
    );

    expect(getUploadRejectionMessage(rejectedUploads)).toBe(
      "empty.mp3 is empty.\nsong.wav is not an mp3.",
    );
  });

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

  it("quietly sanitizes manual filenames before metadata is committed", () => {
    const submittedMetadata = getSubmittedAudioMetadata(
      metadata({ filename: " ../mix/name?.mp3 " }),
      false,
    );

    expect(submittedMetadata.filename).toBe("-mix-name-.mp3");
  });

  it("preserves an empty manual filename as a blocking validation state", () => {
    const submittedMetadata = getSubmittedAudioMetadata(metadata({ filename: "   " }), false);

    expect(submittedMetadata.filename).toBe("");
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

  it("keeps invalid advanced form artifacts out of sparse patches", () => {
    expect(
      createDirtyMetadataPatch(
        metadata({ discNumber: Number.NaN, bpm: 1.5, composer: "New Composer" }),
        { discNumber: true, bpm: true, composer: true },
        false,
      ),
    ).toEqual({ composer: "New Composer" });
  });

  it("summarizes removed track sources without exposing their URLs", () => {
    expect(
      getTrackSourceMix([
        { id: "local", filename: "local.mp3", status: "saved", downloadStatus: "ready" },
        {
          id: "imported",
          filename: "imported.mp3",
          status: "saved",
          downloadStatus: "ready",
          downloadRequest: { sourceUrl: "https://soundcloud.com/private", audioBitrate: "320" },
        },
      ]),
    ).toBe("mixed");
    expect(getTrackSourceMix([])).toBe("unknown");
  });
});
