import { describe, expect, it } from "vite-plus/test";
import type { AlbumGroup } from "@/features/library/types";
import type { Manifest } from "@/features/share/shareManifest";
import { fingerprintSharedAlbum, shareAlbumActionState } from "@/features/share/sharePublication";

const manifest: Manifest = {
  version: 1,
  kind: "album",
  album: { title: "Signal", artist: "June", genre: "Electronic" },
  tracks: [
    {
      sourceUrl: "https://soundcloud.com/june/one",
      audioBitrate: "320",
      metadata: {
        filename: "01-one",
        title: "One",
        artist: "June",
        album: "Signal",
        genre: "Electronic",
        trackNumber: 1,
      },
    },
    {
      sourceUrl: "https://soundcloud.com/june/two",
      audioBitrate: "256",
      metadata: {
        filename: "02-two",
        title: "Two",
        artist: "June",
        album: "Signal",
        genre: "Electronic",
        trackNumber: 2,
      },
    },
  ],
};

const album = (overrides: Partial<AlbumGroup> = {}): AlbumGroup => ({
  id: "album",
  title: "Signal",
  artist: "June",
  genre: "Electronic",
  trackIds: ["one", "two"],
  ...overrides,
});

describe("shared album publication state", () => {
  it("fingerprints the exact ordered manifest and artwork bytes", async () => {
    const original = await fingerprintSharedAlbum(manifest, new Uint8Array([1, 2]));
    const keyOrderOnly = await fingerprintSharedAlbum(
      { tracks: manifest.tracks, album: manifest.album, kind: "album", version: 1 },
      new Uint8Array([1, 2]),
    );
    const renamed = await fingerprintSharedAlbum(
      {
        ...manifest,
        tracks: [
          {
            ...manifest.tracks[0]!,
            metadata: { ...manifest.tracks[0]!.metadata, filename: "one" },
          },
          manifest.tracks[1]!,
        ],
      },
      new Uint8Array([1, 2]),
    );
    const reordered = await fingerprintSharedAlbum(
      { ...manifest, tracks: [manifest.tracks[1]!, manifest.tracks[0]!] },
      new Uint8Array([1, 2]),
    );
    const newArtwork = await fingerprintSharedAlbum(manifest, new Uint8Array([1, 3]));

    expect(keyOrderOnly).toBe(original);
    expect(new Set([original, renamed, reordered, newArtwork])).toHaveLength(4);
  });

  it("never republishes imported albums", () => {
    expect(
      shareAlbumActionState(album({ sourceManifestSlug: "source" }), undefined, false),
    ).toEqual({
      enabled: false,
      label: "share album",
      reason: "shared albums cannot be shared again",
    });
  });

  it("opens an unchanged active publication and updates only after changes", () => {
    const published = album({
      sharePublication: {
        slug: "slug",
        url: "https://tagium.app/share/slug",
        expiresAt: "2030-01-01T00:00:00.000Z",
        publishedFingerprint: "published",
        status: "active",
      },
    });
    expect(shareAlbumActionState(published, "published", true, 0)).toEqual({
      enabled: true,
      label: "view share link",
      reason: "view share link",
    });
    expect(shareAlbumActionState(published, "edited", true, 0)).toMatchObject({
      enabled: true,
      label: "update shared album",
    });
    expect(shareAlbumActionState(published, "edited", false, 0)).toMatchObject({
      enabled: false,
      reason: "this browser cannot update the shared album",
    });
  });

  it("creates a fresh link after a publication stops or expires", () => {
    const publication = {
      slug: "slug",
      url: "https://tagium.app/share/slug",
      expiresAt: "2030-01-01T00:00:00.000Z",
      publishedFingerprint: "published",
      status: "active" as const,
    };
    expect(
      shareAlbumActionState(
        album({ sharePublication: { ...publication, status: "stopped" } }),
        "edited",
        false,
        0,
      ),
    ).toEqual({
      enabled: true,
      label: "share album",
      reason: "create a new share link",
    });
    expect(
      shareAlbumActionState(
        album({ sharePublication: publication }),
        "edited",
        false,
        Date.parse("2031-01-01"),
      ),
    ).toEqual({
      enabled: true,
      label: "share album",
      reason: "create a new share link",
    });
  });
});
