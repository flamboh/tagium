import { describe, expect, it } from "vite-plus/test";
import {
  applyAlbumCoverToFiles,
  applyAlbumCoverToFilesWithSelectedMetadata,
  applyAlbumSharedTagsToFiles,
  applySyncedFilenamesToFiles,
  applyTrackOrderNumbersToFiles,
  areAlbumTrackCoversSynced,
  prepareDownloadedTrackHydration,
  resolveDownloadedTrackHydrationWrite,
  resolveDownloadedTrackHydrationWriteError,
} from "./fileMetadataOps";
import { AudioMetadata, TagiumFile } from "./types";

const metadata = (overrides: Partial<AudioMetadata> = {}): AudioMetadata => ({
  filename: "track",
  title: "Track",
  artist: "Artist",
  album: "Album",
  year: 2024,
  genre: "",
  duration: 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  trackNumber: undefined,
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
        metadata: {
          filename: "track-1",
          title: "Track 1",
          artist: "Artist",
          album: "Album",
          year: 2024,
          genre: "",
          duration: 0,
          bitrate: 0,
          sampleRate: 0,
          picture: [],
          trackNumber: undefined,
        },
      },
      {
        id: "track-2",
        file: new File(["b"], "track-2.mp3", { type: "audio/mpeg" }),
        originalFile: new File(["b"], "track-2.mp3", { type: "audio/mpeg" }),
        filename: "track-2.mp3",
        status: "pending" as const,
        downloadStatus: "ready" as const,
        hasBufferedChanges: false,
        metadata: {
          filename: "track-2",
          title: "Track 2",
          artist: "Artist",
          album: "Album",
          year: 2024,
          genre: "",
          duration: 0,
          bitrate: 0,
          sampleRate: 0,
          picture: [],
          trackNumber: undefined,
        },
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
    expect(result[0].metadata?.trackNumber).toBe(2);
    expect(result[1].metadata?.trackNumber).toBe(1);
  });

  it("applies shared album metadata without applying album cover", () => {
    const originalCover = [
      {
        format: "image/jpeg",
        type: 3,
        description: "cover",
        data: new Uint8Array([1, 2, 3]),
      },
    ];

    const files = [
      {
        id: "track-1",
        file: new File(["a"], "track-1.mp3", { type: "audio/mpeg" }),
        originalFile: new File(["a"], "track-1.mp3", { type: "audio/mpeg" }),
        filename: "track-1.mp3",
        status: "saved" as const,
        downloadStatus: "ready" as const,
        hasBufferedChanges: false,
        metadata: {
          filename: "track-1",
          title: "Track 1",
          artist: "Old Artist",
          album: "Old Album",
          year: 2024,
          genre: "",
          duration: 0,
          bitrate: 0,
          sampleRate: 0,
          picture: originalCover,
          trackNumber: 9,
        },
      },
    ];

    const album = {
      id: "album-1",
      title: "New Album",
      artist: "New Artist",
      genre: "Ambient",
      cover: [
        {
          format: "image/png",
          type: 3,
          description: "album cover",
          data: new Uint8Array([4, 5, 6]),
        },
      ],
      trackIds: ["track-1"],
    };

    const [updatedFile] = applyAlbumSharedTagsToFiles(files, album);

    expect(updatedFile.status).toBe("pending");
    expect(updatedFile.hasBufferedChanges).toBe(true);
    expect(updatedFile.metadata?.artist).toBe("New Artist");
    expect(updatedFile.metadata?.album).toBe("New Album");
    expect(updatedFile.metadata?.genre).toBe("Ambient");
    expect(updatedFile.metadata?.trackNumber).toBe(9);
    expect(updatedFile.metadata?.picture).toEqual(originalCover);
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

  it("treats divergent track cover bytes as not synced with the album cover", () => {
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
              description: "custom cover",
              data: new Uint8Array([1, 2, 4]),
            },
          ],
        }),
      }),
    ];

    expect(areAlbumTrackCoversSynced(files, ["track-1", "track-2"], albumCover)).toBe(false);
  });

  it("treats all missing track covers as synced with a missing album cover", () => {
    const files = [
      readyFile({
        id: "track-1",
        metadata: metadata({ picture: [] }),
      }),
      readyFile({
        id: "track-2",
        metadata: metadata({ picture: [] }),
      }),
    ];

    expect(areAlbumTrackCoversSynced(files, ["track-1", "track-2"], undefined)).toBe(true);
  });

  it("returns selected metadata with applied cover after buffering dirty form metadata", () => {
    const oldFormCover = [
      {
        format: "image/png",
        type: 3,
        description: "old dirty form cover",
        data: new Uint8Array([9]),
      },
    ];
    const albumCover = [
      {
        format: "image/jpeg",
        type: 3,
        description: "album cover",
        data: new Uint8Array([1, 2, 3]),
      },
    ];
    const dirtySelectedMetadata = metadata({
      filename: "dirty-title",
      title: "Dirty Title",
      picture: oldFormCover,
    });
    const files = [
      readyFile({
        id: "track-1",
        filename: "dirty-title.mp3",
        metadata: dirtySelectedMetadata,
        hasBufferedChanges: true,
      }),
      readyFile({
        id: "track-2",
        metadata: metadata({ picture: [] }),
      }),
    ];

    const result = applyAlbumCoverToFilesWithSelectedMetadata(
      files,
      ["track-1", "track-2"],
      albumCover,
      "track-1",
    );

    expect(result.files[0].metadata?.title).toBe("Dirty Title");
    expect(result.files[0].metadata?.picture).toEqual(albumCover);
    expect(result.selectedMetadata?.title).toBe("Dirty Title");
    expect(result.selectedMetadata?.picture).toEqual(albumCover);
    expect(result.files[1].metadata?.picture).toEqual(albumCover);
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
    expect(result[1].filename).toBe("Same.mp3");
    expect(result[1].metadata?.filename).toBe("Same");
  });

  it("can sync filenames for a selected track set", () => {
    const files = [
      readyFile({
        id: "track-1",
        filename: "old.mp3",
        metadata: metadata({ filename: "old", title: "Selected Track" }),
      }),
      readyFile({
        id: "track-2",
        filename: "old-too.mp3",
        metadata: metadata({ filename: "old-too", title: "Unselected Track" }),
      }),
    ];

    const result = applySyncedFilenamesToFiles(files, ["track-1"]);

    expect(result[0].filename).toBe("Selected Track.mp3");
    expect(result[1]).toBe(files[1]);
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
  });

  it("keeps latest dirty form metadata when hydration write resolves", () => {
    const currentFile = readyFile({
      file: undefined,
      originalFile: undefined,
      filename: "first-form-edit.mp3",
      downloadStatus: "downloading",
      hasBufferedChanges: false,
      metadata: metadata({ filename: "placeholder", title: "Placeholder" }),
    });
    const parsedFile = readyFile({
      metadata: metadata({
        filename: "parsed-title",
        title: "Parsed Title",
        duration: 95,
        bitrate: 320,
        sampleRate: 44100,
      }),
    });
    const firstFormMetadata = metadata({
      filename: "first-form-edit",
      title: "First Form Edit",
    });
    const { hydratedFile, metadataToWrite } = prepareDownloadedTrackHydration(
      currentFile,
      parsedFile,
      firstFormMetadata,
    );
    const latestFormMetadata = metadata({
      filename: "second-form-edit",
      title: "Second Form Edit",
    });
    const updatedFile = new File(["updated"], "first-form-edit.mp3", { type: "audio/mpeg" });

    const result = resolveDownloadedTrackHydrationWrite(
      currentFile,
      currentFile,
      parsedFile,
      hydratedFile,
      updatedFile,
      metadataToWrite!,
      latestFormMetadata,
    );

    expect(result.file).toBe(updatedFile);
    expect(result.filename).toBe("second-form-edit.mp3");
    expect(result.metadata?.title).toBe("Second Form Edit");
    expect(result.metadata?.duration).toBe(95);
    expect(result.metadata?.bitrate).toBe(320);
    expect(result.status).toBe("pending");
    expect(result.hasBufferedChanges).toBe(true);
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
  });

  it("uses dirty form metadata during hydration while preserving parsed technical fields", () => {
    const currentFile = readyFile({
      file: undefined,
      originalFile: undefined,
      downloadStatus: "downloading",
      hasBufferedChanges: false,
      metadata: metadata({ filename: "placeholder", title: "Placeholder" }),
    });
    const parsedFile = readyFile({
      metadata: metadata({
        filename: "parsed-title",
        title: "Parsed Title",
        duration: 45,
        bitrate: 256,
        sampleRate: 48000,
      }),
    });
    const formMetadata = metadata({ filename: "form-title", title: "Form Title" });

    const { hydratedFile, metadataToWrite } = prepareDownloadedTrackHydration(
      currentFile,
      parsedFile,
      formMetadata,
    );

    expect(metadataToWrite?.title).toBe("Form Title");
    expect(hydratedFile.filename).toBe("form-title.mp3");
    expect(hydratedFile.metadata?.title).toBe("Form Title");
    expect(hydratedFile.metadata?.duration).toBe(45);
    expect(hydratedFile.metadata?.bitrate).toBe(256);
    expect(hydratedFile.metadata?.sampleRate).toBe(48000);
    expect(hydratedFile.hasBufferedChanges).toBe(true);
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
