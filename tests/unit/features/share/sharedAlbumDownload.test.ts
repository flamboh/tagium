import { describe, expect, it } from "vite-plus/test";
import { createSharedAlbumDownloadPlan } from "@/features/share/sharedAlbumDownload";
import type { Manifest } from "@/features/share/shareManifest";

describe("shared album download planning", () => {
  it("reuses playlist planning while preserving exact per-track tags, bitrate, cover, and provenance", () => {
    const manifest: Manifest = {
      version: 1,
      kind: "album",
      album: {
        title: "Creator title",
        artist: "Various",
        genre: "Set",
        year: 2024,
        artwork: {
          kind: "stored",
          format: "image/png",
          type: 3,
          description: "creator APIC description",
        },
      },
      tracks: [
        {
          sourceUrl: "https://soundcloud.com/example/one",
          audioBitrate: "320",
          metadata: {
            filename: "a custom filename",
            title: "One",
            artist: "Track artist",
            album: "Track album",
            genre: "Track genre",
            year: 2023,
            trackNumber: 7,
          },
        },
        {
          sourceUrl: "https://youtube.com/watch?v=two",
          audioBitrate: "128",
          metadata: {
            filename: "second",
            title: "Two",
            artist: "Another artist",
            album: "Another album",
            genre: "Ambient",
          },
        },
      ],
    };
    let id = 0;
    const cover = [
      {
        format: "image/png",
        type: 3,
        description: "shared cover",
        data: new Uint8Array(new ArrayBuffer(3)),
      },
    ];
    const plan = createSharedAlbumDownloadPlan(
      manifest,
      "AbcdEFGHijklmno_123-45",
      () => `id-${++id}`,
      cover,
    );

    expect(plan.album.sourceManifestSlug).toBe("AbcdEFGHijklmno_123-45");
    expect(plan.album.cover).toBe(cover);
    expect(plan.album.cover?.[0]).toMatchObject({ type: 3, description: "shared cover" });
    expect(plan.pendingFiles[0]).toMatchObject({
      filename: "a custom filename.mp3",
      metadata: {
        title: "One",
        artist: "Track artist",
        album: "Track album",
        genre: "Track genre",
        year: 2023,
        trackNumber: 7,
        picture: cover,
      },
      downloadRequest: {
        sourceUrl: "https://soundcloud.com/example/one",
        audioBitrate: "320",
      },
    });
    expect(plan.pendingFiles[1]?.downloadRequest.audioBitrate).toBe("128");
    expect(plan.pendingFiles[1]?.metadata.year).toBeNull();
    expect(plan.queuedTracks.map((track) => track.fileId)).toEqual(
      plan.pendingFiles.map((file) => file.id),
    );
  });
});
