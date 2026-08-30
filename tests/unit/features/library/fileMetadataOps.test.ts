import { describe, expect, it } from "vite-plus/test";
import {
  applyAlbumCoverToFiles,
  applyAlbumSharedTagsToFiles,
  applySingleAlbumTitlesToFiles,
  applySyncedFilenamesToFiles,
  applyTrackOrderNumbersToFiles,
  areAlbumTrackCoversSynced,
  prepareDownloadedTrackHydration,
  resolveDownloadedTrackHydrationWrite,
  resolveDownloadedTrackHydrationWriteError,
  sanitizePendingMetadataPatch,
} from "@/features/library/fileMetadataOps";
import { AudioMetadata, TagiumFile } from "@/features/library/types";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";

const metadata = (overrides: Partial<AudioMetadata> = {}): AudioMetadata => ({
  filename: "track",
  title: "Track",
  artist: "Artist",
  albumArtist: "Artist",
  album: "Album",
  year: 2024,
  genre: "",
  duration: 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  trackNumber: null,
  composer: "",
  comment: "",
  discNumber: null,
  bpm: null,
  ...overrides,
});

const readyFile = (overrides: Partial<TagiumFile> = {}): TagiumFile => ({
  id: "track-1",
  file: new File(["a"], "track-1.mp3", { type: "audio/mpeg" }),
  originalFile: new File(["a"], "track-1.mp3", { type: "audio/mpeg" }),
  filename: "track-1.mp3",
  status: "pending",
  downloadStatus: "ready",
  hasBufferedChanges: false,
  metadata: metadata({ filename: "track-1", title: "Track 1" }),
  ...overrides,
});

describe("fileMetadataOps", () => {
  it("links a single's album title to its track title when enabled", () => {
    const file = readyFile({
      status: "saved",
      metadata: metadata({ title: "Single Title", album: "Old Album" }),
    });

    const [linked] = applySingleAlbumTitlesToFiles([file], [file.id], DEFAULT_APP_SETTINGS);
    const [unlinked] = applySingleAlbumTitlesToFiles([file], [file.id], {
      ...DEFAULT_APP_SETTINGS,
      metadataLinks: { ...DEFAULT_APP_SETTINGS.metadataLinks, singleAlbum: false },
    });

    expect(linked).toMatchObject({
      status: "pending",
      metadata: { album: "Single Title" },
      pendingMetadataPatch: { album: "Single Title" },
    });
    expect(unlinked).toBe(file);
  });

  it("sanitizes sparse numeric metadata patches without losing explicit clears", () => {
    expect(
      sanitizePendingMetadataPatch({
        title: undefined,
        discNumber: null,
        bpm: 140,
      }),
    ).toEqual({
      discNumber: null,
      bpm: 140,
    });
    expect(sanitizePendingMetadataPatch({ discNumber: null, bpm: 140 }, true)).toBeUndefined();
    expect(
      sanitizePendingMetadataPatch({
        discNumber: Number.NaN,
        bpm: 0,
      }),
    ).toBeUndefined();
  });

  it("applies synced track numbers and resets saved files to pending", () => {
    const files = [
      {
        id: "track-1",
        file: new File(["a"], "track-1.mp3", { type: "audio/mpeg" }),
        originalFile: new File(["a"], "track-1.mp3", { type: "audio/mpeg" }),
        filename: "track-1.mp3",
        status: "saved" as const,
        downloadStatus: "ready" as const,
        hasBufferedChanges: false,
        metadata: metadata({ filename: "track-1", title: "Track 1" }),
      },
      {
        id: "track-2",
        file: new File(["b"], "track-2.mp3", { type: "audio/mpeg" }),
        originalFile: new File(["b"], "track-2.mp3", { type: "audio/mpeg" }),
        filename: "track-2.mp3",
        status: "pending" as const,
        downloadStatus: "ready" as const,
        hasBufferedChanges: false,
        metadata: metadata({ filename: "track-2", title: "Track 2" }),
      },
    ];

    const albums = [
      {
        id: "album-1",
        title: "Album",
        artist: "Artist",
        genre: "",
        trackIds: ["track-2", "track-1"],
      },
    ];

    const result = applyTrackOrderNumbersToFiles(files, albums, ["album-1"]);

    expect(result[0].status).toBe("pending");
    expect(result[0].hasBufferedChanges).toBe(true);
    expect(result[0].pendingMetadataPatch?.trackNumber).toBe(2);
    expect(result[0].metadata?.trackNumber).toBe(2);
    expect(result[1].metadata?.trackNumber).toBe(1);
    expect(result[1].pendingMetadataPatch?.trackNumber).toBe(1);
  });

  it("applies the complete album policy while leaving unlinked and unrelated fields alone", () => {
    const cover = [
      {
        format: "image/jpeg",
        type: 3,
        description: "cover",
        data: new Uint8Array([1]),
      },
    ];
    const file = readyFile({
      metadata: metadata({
        artist: "Track Artist",
        albumArtist: "Custom Album Artist",
        album: "Old Album",
        year: 1999,
        genre: "Track Genre",
        picture: [],
        trackNumber: 9,
        discNumber: 2,
        composer: "Composer",
        bpm: 123,
        comment: "Keep",
      }),
    });
    const album = {
      id: "album-1",
      title: "New Album",
      artist: "Album Artist",
      genre: "Album Genre",
      year: 2026,
      cover,
      trackIds: [file.id],
    };
    const settings = {
      ...DEFAULT_APP_SETTINGS,
      advancedMetadata: true,
      metadataLinks: {
        ...DEFAULT_APP_SETTINGS.metadataLinks,
        artist: false,
        year: true,
        genre: false,
        artwork: true,
        albumArtist: false,
      },
    };

    const [shared] = applyAlbumSharedTagsToFiles([file], album, settings);
    const [covered] = applyAlbumCoverToFiles([shared], album.trackIds, cover, settings);
    const [ordered] = applyTrackOrderNumbersToFiles([covered], [album], [album.id], settings);

    expect(ordered.metadata).toMatchObject({
      artist: "Track Artist",
      albumArtist: "Custom Album Artist",
      album: "New Album",
      year: 2026,
      genre: "Track Genre",
      picture: cover,
      trackNumber: 1,
      discNumber: 2,
      composer: "Composer",
      bpm: 123,
      comment: "Keep",
    });
    expect(ordered.pendingMetadataPatch).toEqual({
      album: "New Album",
      year: 2026,
      picture: cover,
      trackNumber: 1,
    });
  });

  it("explicitly applies album cover to album tracks", () => {
    const albumCover = [
      {
        format: "image/jpeg",
        type: 3,
        description: "album cover",
        data: new Uint8Array([1, 2, 3]),
      },
    ];
    const files = [
      readyFile({
        id: "track-1",
        status: "saved",
        metadata: metadata({ picture: [] }),
      }),
      readyFile({
        id: "track-2",
        metadata: metadata({
          picture: [
            {
              format: "image/png",
              type: 3,
              description: "old cover",
              data: new Uint8Array([9]),
            },
          ],
        }),
      }),
      readyFile({
        id: "track-3",
        metadata: metadata({ picture: [] }),
      }),
    ];

    const result = applyAlbumCoverToFiles(files, ["track-1", "track-2"], albumCover);

    expect(result[0].metadata?.picture).toEqual(albumCover);
    expect(result[0].status).toBe("pending");
    expect(result[0].hasBufferedChanges).toBe(true);
    expect(result[0].pendingMetadataPatch?.picture).toEqual(albumCover);
    expect(result[1].metadata?.picture).toEqual(albumCover);
    expect(result[1].hasBufferedChanges).toBe(true);
    expect(result[2]).toBe(files[2]);
  });

  it("detects album cover sync by comparing image format and bytes", () => {
    const albumCover = [
      {
        format: "image/jpeg",
        type: 3,
        description: "album cover",
        data: new Uint8Array([1, 2, 3]),
      },
    ];
    const files = [
      readyFile({
        id: "track-1",
        metadata: metadata({ picture: albumCover }),
      }),
      readyFile({
        id: "track-2",
        metadata: metadata({
          picture: [
            {
              format: "image/jpeg",
              type: 3,
              description: "same bytes",
              data: new Uint8Array([1, 2, 3]),
            },
          ],
        }),
      }),
    ];

    expect(areAlbumTrackCoversSynced(files, ["track-1", "track-2"], albumCover)).toBe(true);
  });

  it("syncs filenames from titles across any tracks", () => {
    const files = [
      readyFile({
        id: "track-1",
        filename: "old.mp3",
        status: "saved",
        metadata: metadata({ filename: "old", title: "New Track Title" }),
      }),
      readyFile({
        id: "track-2",
        filename: "same.mp3",
        status: "pending",
        metadata: metadata({ filename: "same", title: "Same" }),
      }),
    ];

    const result = applySyncedFilenamesToFiles(files);

    expect(result[0].filename).toBe("New Track Title.mp3");
    expect(result[0].metadata?.filename).toBe("New Track Title");
    expect(result[0].status).toBe("pending");
    expect(result[0].hasBufferedChanges).toBe(true);
    expect(result[0].pendingMetadataPatch?.filename).toBe("New Track Title");
    expect(result[1].filename).toBe("Same.mp3");
    expect(result[1].metadata?.filename).toBe("Same");
  });

  it("keeps buffered metadata while hydrating downloaded technical fields", () => {
    const parsedCover = [
      {
        format: "image/jpeg",
        type: 3,
        description: "parsed cover",
        data: new Uint8Array([4, 5, 6]),
      },
    ];
    const currentFile = readyFile({
      file: undefined,
      originalFile: undefined,
      filename: "edited-title.mp3",
      downloadStatus: "downloading",
      hasBufferedChanges: true,
      metadata: metadata({
        filename: "edited-title",
        title: "Edited Title",
        album: "Edited Album",
      }),
    });
    const parsedFile = readyFile({
      filename: "parsed-title.mp3",
      metadata: metadata({
        filename: "parsed-title",
        title: "Parsed Title",
        duration: 123,
        bitrate: 320,
        sampleRate: 44100,
        picture: parsedCover,
      }),
    });

    const result = prepareDownloadedTrackHydration(currentFile, parsedFile);

    expect(result.metadataToWrite?.title).toBe("Edited Title");
    expect(result.hydratedFile.filename).toBe("edited-title.mp3");
    expect(result.hydratedFile.metadata?.album).toBe("Edited Album");
    expect(result.hydratedFile.metadata?.duration).toBe(123);
    expect(result.hydratedFile.metadata?.bitrate).toBe(320);
    expect(result.hydratedFile.metadata?.sampleRate).toBe(44100);
    expect(result.hydratedFile.metadata?.picture).toEqual(parsedCover);
    expect(result.hydratedFile.status).toBe("pending");
    expect(result.hydratedFile.downloadStatus).toBe("ready");
  });

  it("clears parsed year and track number when pending patch sets them to null", () => {
    const currentFile = readyFile({
      file: undefined,
      originalFile: undefined,
      downloadStatus: "downloading",
      metadata: metadata({
        filename: "provider-title",
        title: "Provider Title",
      }),
    });
    const parsedFile = readyFile({
      metadata: metadata({
        filename: "parsed-title",
        title: "Parsed Title",
        year: 2024,
        trackNumber: 9,
      }),
    });

    const { hydratedFile, metadataToWrite } = prepareDownloadedTrackHydration(
      currentFile,
      parsedFile,
      {
        year: null,
        trackNumber: null,
      },
    );

    expect(hydratedFile.metadata?.year).toBeNull();
    expect(hydratedFile.metadata?.trackNumber).toBeNull();
    expect(metadataToWrite?.year).toBeNull();
    expect(metadataToWrite?.trackNumber).toBeNull();
  });

  it("keeps later buffered edits when stale hydration write resolves", () => {
    const currentFile = readyFile({
      file: undefined,
      originalFile: undefined,
      filename: "old-edit.mp3",
      downloadStatus: "downloading",
      hasBufferedChanges: true,
      metadata: metadata({ filename: "old-edit", title: "Old Edit" }),
    });
    const parsedFile = readyFile({
      filename: "parsed-title.mp3",
      metadata: metadata({
        filename: "parsed-title",
        title: "Parsed Title",
        duration: 88,
        bitrate: 320,
        sampleRate: 44100,
      }),
    });
    const { hydratedFile, metadataToWrite } = prepareDownloadedTrackHydration(
      currentFile,
      parsedFile,
    );
    const latestFile = {
      ...currentFile,
      filename: "new-edit.mp3",
      metadata: metadata({ filename: "new-edit", title: "New Edit" }),
    };
    const updatedFile = new File(["updated"], "old-edit.mp3", { type: "audio/mpeg" });

    const result = resolveDownloadedTrackHydrationWrite(
      currentFile,
      latestFile,
      parsedFile,
      hydratedFile,
      updatedFile,
      metadataToWrite!,
    );

    expect(result.file).toBe(updatedFile);
    expect(result.originalFile).toBe(updatedFile);
    expect(result.filename).toBe("new-edit.mp3");
    expect(result.metadata?.title).toBe("New Edit");
    expect(result.metadata?.duration).toBe(88);
    expect(result.metadata?.bitrate).toBe(320);
    expect(result.metadata?.sampleRate).toBe(44100);
    expect(result.status).toBe("pending");
    expect(result.hasBufferedChanges).toBe(true);
    expect(result.downloadStatus).toBe("ready");
  });

  it("marks buffered pending saves as saved when hydration write succeeds", () => {
    const currentFile = readyFile({
      file: undefined,
      originalFile: undefined,
      filename: "saved-while-downloading.mp3",
      downloadStatus: "downloading",
      hasBufferedChanges: true,
      metadata: metadata({
        filename: "saved-while-downloading",
        title: "Saved While Downloading",
      }),
    });
    const parsedFile = readyFile({
      metadata: metadata({
        filename: "parsed-title",
        title: "Parsed Title",
        duration: 101,
        bitrate: 320,
        sampleRate: 44100,
      }),
    });
    const { hydratedFile, metadataToWrite } = prepareDownloadedTrackHydration(
      currentFile,
      parsedFile,
    );
    const updatedFile = new File(["updated"], "saved-while-downloading.mp3", {
      type: "audio/mpeg",
    });

    const result = resolveDownloadedTrackHydrationWrite(
      currentFile,
      currentFile,
      parsedFile,
      hydratedFile,
      updatedFile,
      metadataToWrite!,
    );

    expect(result.file).toBe(updatedFile);
    expect(result.filename).toBe("saved-while-downloading.mp3");
    expect(result.metadata?.title).toBe("Saved While Downloading");
    expect(result.metadata?.duration).toBe(101);
    expect(result.status).toBe("saved");
    expect(result.hasBufferedChanges).toBe(false);
    expect(result.pendingMetadataPatch).toBeUndefined();
  });

  it("keeps buffered metadata and error message when hydration write fails", () => {
    const currentFile = readyFile({
      file: undefined,
      originalFile: undefined,
      filename: "edited-title.mp3",
      downloadStatus: "downloading",
      hasBufferedChanges: true,
      metadata: metadata({ filename: "edited-title", title: "Edited Title" }),
    });
    const parsedFile = readyFile({
      filename: "parsed-title.mp3",
      metadata: metadata({
        filename: "parsed-title",
        title: "Parsed Title",
        duration: 92,
        bitrate: 256,
        sampleRate: 48000,
      }),
    });
    const { hydratedFile } = prepareDownloadedTrackHydration(currentFile, parsedFile);

    const result = resolveDownloadedTrackHydrationWriteError(
      currentFile,
      currentFile,
      parsedFile,
      hydratedFile,
      "Unable to save metadata",
    );

    expect(result.file).toBe(parsedFile.file);
    expect(result.filename).toBe("edited-title.mp3");
    expect(result.metadata?.title).toBe("Edited Title");
    expect(result.metadata?.duration).toBe(92);
    expect(result.metadata?.bitrate).toBe(256);
    expect(result.metadata?.sampleRate).toBe(48000);
    expect(result.status).toBe("error");
    expect(result.downloadStatus).toBe("ready");
    expect(result.downloadError).toBe("Unable to save metadata");
    expect(result.hasBufferedChanges).toBe(true);
    expect(result.pendingMetadataPatch?.title).toBe("Edited Title");
  });

  it("keeps later edits when stale hydration write fails", () => {
    const currentFile = readyFile({
      file: undefined,
      originalFile: undefined,
      filename: "old-edit.mp3",
      downloadStatus: "downloading",
      hasBufferedChanges: true,
      metadata: metadata({ filename: "old-edit", title: "Old Edit" }),
    });
    const latestFile = {
      ...currentFile,
      filename: "new-edit.mp3",
      metadata: metadata({ filename: "new-edit", title: "New Edit" }),
    };
    const parsedFile = readyFile({
      filename: "parsed-title.mp3",
      metadata: metadata({
        filename: "parsed-title",
        title: "Parsed Title",
        duration: 93,
        bitrate: 128,
        sampleRate: 32000,
      }),
    });
    const { hydratedFile } = prepareDownloadedTrackHydration(currentFile, parsedFile);

    const result = resolveDownloadedTrackHydrationWriteError(
      currentFile,
      latestFile,
      parsedFile,
      hydratedFile,
      "Unable to save metadata",
    );

    expect(result.file).toBe(parsedFile.file);
    expect(result.filename).toBe("new-edit.mp3");
    expect(result.metadata?.title).toBe("New Edit");
    expect(result.metadata?.duration).toBe(93);
    expect(result.metadata?.bitrate).toBe(128);
    expect(result.metadata?.sampleRate).toBe(32000);
    expect(result.status).toBe("error");
    expect(result.downloadError).toBe("Unable to save metadata");
    expect(result.pendingMetadataPatch?.title).toBe("New Edit");
  });

  it("uses dirty form cover during hydration", () => {
    const parsedCover = [
      {
        format: "image/jpeg",
        type: 3,
        description: "parsed cover",
        data: new Uint8Array([1]),
      },
    ];
    const formCover = [
      {
        format: "image/png",
        type: 3,
        description: "uploaded cover",
        data: new Uint8Array([2]),
      },
    ];
    const currentFile = readyFile({
      file: undefined,
      originalFile: undefined,
      downloadStatus: "downloading",
      hasBufferedChanges: false,
      metadata: metadata({ picture: [] }),
    });
    const parsedFile = readyFile({
      metadata: metadata({ picture: parsedCover }),
    });
    const formMetadata = metadata({ picture: formCover });

    const { hydratedFile, metadataToWrite } = prepareDownloadedTrackHydration(
      currentFile,
      parsedFile,
      formMetadata,
    );

    expect(metadataToWrite?.picture).toEqual(formCover);
    expect(hydratedFile.metadata?.picture).toEqual(formCover);
    expect(hydratedFile.hasBufferedChanges).toBe(true);
  });

  it("preserves parse failure messages during hydration", () => {
    const currentFile = readyFile({
      file: undefined,
      originalFile: undefined,
      downloadStatus: "downloading",
      metadata: metadata({ filename: "placeholder", title: "Placeholder" }),
    });
    const parsedFile = readyFile({
      status: "error",
      downloadError: "Invalid ID3 tag",
      metadata: undefined,
    });

    const { hydratedFile } = prepareDownloadedTrackHydration(currentFile, parsedFile);

    expect(hydratedFile.status).toBe("error");
    expect(hydratedFile.downloadStatus).toBe("ready");
    expect(hydratedFile.downloadError).toBe("Invalid ID3 tag");
  });
});
