import { describe, expect, it } from "vite-plus/test";
import { applyAlbumSharedTagsToFiles, applyTrackOrderNumbersToFiles } from "./fileMetadataOps";

describe("fileMetadataOps", () => {
  it("applies synced track numbers and resets saved files to pending", () => {
    const files = [
      {
        id: "track-1",
        file: new File(["a"], "track-1.mp3", { type: "audio/mpeg" }),
        originalFile: new File(["a"], "track-1.mp3", { type: "audio/mpeg" }),
        filename: "track-1.mp3",
        status: "saved" as const,
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
        syncTrackNumbers: true,
        syncFilenames: false,
      },
    ];

    const result = applyTrackOrderNumbersToFiles(files, albums, ["album-1"]);

    expect(result[0].status).toBe("pending");
    expect(result[0].metadata?.trackNumber).toBe(2);
    expect(result[1].metadata?.trackNumber).toBe(1);
  });

  it("applies shared album metadata and preserves existing cover when none is provided", () => {
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
      trackIds: ["track-1"],
      syncTrackNumbers: false,
      syncFilenames: false,
    };

    const [updatedFile] = applyAlbumSharedTagsToFiles(files, album);

    expect(updatedFile.status).toBe("pending");
    expect(updatedFile.metadata?.artist).toBe("New Artist");
    expect(updatedFile.metadata?.album).toBe("New Album");
    expect(updatedFile.metadata?.genre).toBe("Ambient");
    expect(updatedFile.metadata?.trackNumber).toBe(9);
    expect(updatedFile.metadata?.picture).toEqual(originalCover);
  });
});
