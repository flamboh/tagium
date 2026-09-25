import { describe, expect, it } from "vite-plus/test";
import { shareEligibility, shareTrackEligibility } from "@/features/share/shareEligibility";
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
    audioFormat: "mp3" as const,
  },
  metadata: {
    filename: "track",
    title: "Track",
    artist: "Artist",
    albumArtist: "Artist",
    album: "Album",
    genre: "Genre",
    year: null,
    trackNumber: null,
    composer: "",
    comment: "",
    discNumber: null,
    bpm: null,
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

  it("rejects local albums containing a track received from a share link", () => {
    expect(
      shareEligibility(album, [{ ...importedTrack, sourceManifestSlug: "track-source" }]),
    ).toMatch(/containing tracks added from share links/i);
  });

  it("accepts replayable tracks and rejects local or received tracks", () => {
    expect(shareTrackEligibility(importedTrack)).toBeNull();
    expect(shareTrackEligibility({ ...importedTrack, downloadRequest: undefined })).toBe(
      "local tracks cannot be shared",
    );
    expect(shareTrackEligibility({ ...importedTrack, sourceManifestSlug: "source" })).toMatch(
      /share links cannot be shared again/i,
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
          downloadRequest: {
            sourceUrl: "https://example.com/audio",
            audioBitrate: "320",
            audioFormat: "mp3",
          },
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

  it("waits for every album track to finish downloading before sharing", () => {
    const tracks = ["one", "two", "three"].map((id) => ({ ...importedTrack, id }));
    const albumOfThree = { ...album, trackIds: tracks.map((track) => track.id) };
    const downloading = { ...tracks[1]!, downloadStatus: "downloading" as const };
    const failed = { ...tracks[2]!, downloadStatus: "error" as const };

    expect(shareEligibility(albumOfThree, [tracks[0], downloading, tracks[2]])).toBe(
      "1 of 3 tracks is still downloading",
    );
    expect(
      shareEligibility(albumOfThree, [
        { ...tracks[0]!, downloadStatus: "downloading" },
        downloading,
        failed,
      ]),
    ).toBe("2 of 3 tracks are still downloading");
    expect(shareEligibility(albumOfThree, [tracks[0], tracks[1], failed])).toBe(
      "retry or remove the failed track to share this album",
    );
    expect(
      shareEligibility(albumOfThree, [
        tracks[0],
        { ...tracks[1]!, downloadStatus: "canceled" },
        failed,
      ]),
    ).toBe("retry or remove 2 failed tracks to share this album");
  });

  it("waits for a pending album cover before sharing", () => {
    expect(shareEligibility({ ...album, coverPending: true }, [importedTrack])).toBe(
      "the album cover is still loading",
    );
    expect(shareEligibility({ ...album, coverPending: false }, [importedTrack])).toBeNull();
  });

  it("waits for a single track to finish downloading before sharing", () => {
    expect(shareTrackEligibility({ ...importedTrack, downloadStatus: "downloading" })).toBe(
      "this track is still downloading",
    );
    expect(shareTrackEligibility({ ...importedTrack, downloadStatus: "error" })).toBe(
      "retry this track's download to share it",
    );
    expect(shareTrackEligibility({ ...importedTrack, downloadStatus: "canceled" })).toBe(
      "retry this track's download to share it",
    );
  });
});
