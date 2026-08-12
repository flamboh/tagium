import { describe, expect, it } from "vite-plus/test";
import {
  getMetadataLinkDescriptor,
  getMetadataLinkState,
  isMetadataLinkVisible,
  serializeMetadataLinkAnalytics,
  withMetadataLinkEnabled,
} from "@/features/library/metadataLinks";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";

describe("metadata link descriptors", () => {
  it("keeps stable labels, disabled reasons, and analytics-facing ids", () => {
    expect(getMetadataLinkDescriptor("singleAlbum")).toMatchObject({
      label: "sync album with the track title",
      disabledReason: "album is synced with the track title.",
      analyticsProperty: "link_single_album",
      map: { source: "track title", target: "album", group: "fromTrack" },
    });
    expect(getMetadataLinkDescriptor("albumArtist")).toMatchObject({
      label: "sync album artist with the track artist",
      disabledReason: "album artist is synced with the track artist.",
      analyticsProperty: "link_album_artist",
      requiresAdvancedMetadata: true,
    });
    expect(
      isMetadataLinkVisible(getMetadataLinkDescriptor("albumArtist"), DEFAULT_APP_SETTINGS),
    ).toBe(false);
  });

  it("updates and serializes settings through descriptors", () => {
    const updated = withMetadataLinkEnabled(
      DEFAULT_APP_SETTINGS,
      getMetadataLinkDescriptor("artist"),
      false,
    );
    const state = getMetadataLinkState(updated);
    const filenameUnlinked = withMetadataLinkEnabled(
      updated,
      getMetadataLinkDescriptor("filename"),
      false,
    );

    expect(state.artist).toBe(false);
    expect(filenameUnlinked.syncFilenames).toBe(false);
    expect(serializeMetadataLinkAnalytics(state)).toMatchObject({
      link_single_album: true,
      link_artist: false,
      link_album_artist: true,
      sync_track_numbers: true,
      sync_filenames: true,
    });
  });
});
