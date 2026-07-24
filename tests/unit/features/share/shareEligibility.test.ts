import { describe, expect, it } from "vite-plus/test";
import { shareEligibility } from "@/features/share/shareEligibility";
import type { AlbumGroup, TagiumFile } from "@/features/library/types";

const album: AlbumGroup = {
  id: "album",
  title: "Album",
  artist: "Artist",
  genre: "Genre",
  trackIds: ["track"],
};
const importedTrack: TagiumFile = {
  id: "track",
  status: "saved" as const,
  downloadStatus: "ready" as const,
  filename: "track.mp3",
  downloadRequest: {
    sourceUrl: "https://soundcloud.com/artist/track",
    audioBitrate: "320" as const,
  },
  metadata: {
    filename: "track",
    title: "Track",
    artist: "Artist",
    album: "Album",
    genre: "Genre",
    year: null,
    trackNumber: null,
    bitrate: 320,
    duration: 180,
    sampleRate: 44_100,
    picture: [],
  },
};

describe("share eligibility", () => {
  it("rejects albums imported from a shared album", () => {
    expect(shareEligibility({ ...album, sourceManifestSlug: "source" }, [importedTrack])).toBe(
      "shared albums cannot be shared again",
    );
  });
  it("accepts a replayable imported album", () => {
    expect(shareEligibility(album, [importedTrack])).toBeNull();
  });

  it("explains local, unsupported, oversized, and invalid-cover albums before opening the dialog", () => {
    expect(shareEligibility(album, [{ ...importedTrack, downloadRequest: undefined }])).toMatch(
      /imported tracks/i,
    );
    expect(
      shareEligibility(album, [
        {
          ...importedTrack,
          downloadRequest: { sourceUrl: "https://example.com/audio", audioBitrate: "320" },
        },
      ]),
    ).toMatch(/cannot replay/i);
    expect(
      shareEligibility(
        { ...album, trackIds: Array.from({ length: 101 }, (_, index) => String(index)) },
        [importedTrack],
      ),
    ).toMatch(/1 and 100/i);
    expect(
      shareEligibility(
        {
          ...album,
          cover: [{ format: "image/webp", type: 3, description: "x", data: new Uint8Array([1]) }],
        },
        [importedTrack],
      ),
    ).toMatch(/cover format/i);
  });
});
