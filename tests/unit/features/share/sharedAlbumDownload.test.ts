import { describe, expect, it } from "vite-plus/test";
import {
  createSharedAlbumDownloadPlan,
  createSharedContentDownloadPlan,
} from "@/features/share/sharedAlbumDownload";
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
        sourceUrl: "https://www.youtube.com/playlist?list=PL_exact",
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
    expect(plan.album.sourceUrl).toBe(manifest.album.sourceUrl);
    expect(plan.album.cover).toBe(cover);
    expect(plan.album.cover?.[0]).toMatchObject({ type: 3, description: "shared cover" });
    expect(plan.pendingFiles[0]).toMatchObject({
      filename: "a custom filename.mp3",
      sourceManifestSlug: "AbcdEFGHijklmno_123-45",
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

  it("reuses single-track planning and restores exact track fields as a loose track", () => {
    const manifest: Manifest = {
      version: 1,
      kind: "track",
      track: {
        sourceUrl: "https://soundcloud.com/example/shared-track",
        audioBitrate: "256",
        artwork: {
          kind: "stored",
          format: "image/jpeg",
          type: 3,
          description: "shared track cover",
        },
        metadata: {
          filename: "creator filename",
          title: "Creator title",
          artist: "Creator artist",
          album: "Creator album tag",
          genre: "Creator genre",
          year: 2025,
          trackNumber: 4,
        },
      },
    };
    const cover = [
      {
        format: "image/jpeg" as const,
        type: 3,
        description: "shared track cover",
        data: new Uint8Array(new ArrayBuffer(3)),
      },
    ];
    const plan = createSharedContentDownloadPlan(
      manifest,
      "shared-track-slug",
      () => "track-id",
      cover,
    );

    expect(plan.source).toBe("single-url");
    if (plan.source !== "single-url") throw new Error("expected a loose-track plan");
    expect(plan.looseTrackIds).toEqual(["track-id"]);
    expect(plan.pendingFiles[0]).toMatchObject({
      id: "track-id",
      filename: "creator filename.mp3",
      sourceManifestSlug: "shared-track-slug",
      metadata: {
        filename: "creator filename",
        title: "Creator title",
        artist: "Creator artist",
        album: "Creator album tag",
        genre: "Creator genre",
        year: 2025,
        trackNumber: 4,
        picture: cover,
      },
      pendingMetadataPatch: {
        filename: "creator filename",
        title: "Creator title",
        picture: cover,
      },
      downloadRequest: {
        sourceUrl: "https://soundcloud.com/example/shared-track",
        audioBitrate: "256",
        year: 2025,
      },
    });
    expect(plan.queuedTracks).toEqual([
      {
        fileId: "track-id",
        title: "Creator title",
        downloadRequest: plan.pendingFiles[0]?.downloadRequest,
      },
    ]);
  });

  it("restores an explicit no-artwork track snapshot over provider artwork", () => {
    const manifest: Manifest = {
      version: 1,
      kind: "track",
      track: {
        sourceUrl: "https://soundcloud.com/example/no-art",
        audioBitrate: "320",
        metadata: {
          filename: "no art",
          title: "No art",
          artist: "Artist",
          album: "",
          genre: "",
        },
      },
    };

    const plan = createSharedContentDownloadPlan(manifest, "no-art-slug", () => "track-id", [
      {
        format: "image/jpeg",
        type: 3,
        description: "stale provider artwork",
        data: new Uint8Array([1]),
      },
    ]);

    expect(plan.pendingFiles[0]?.metadata.picture).toEqual([]);
    expect(plan.pendingFiles[0]?.pendingMetadataPatch?.picture).toEqual([]);
  });
});
