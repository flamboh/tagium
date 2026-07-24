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
  it("keeps stable labels, relations, disabled reasons, and analytics-facing ids", () => {
    expect(getMetadataLinkDescriptor("albumArtist")).toMatchObject({
      label: "link album artist to track artist",
      relation: "album artist follows track artist",
      disabledReason: "Album artist is synced with the album.",
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

    expect(state.artist).toBe(false);
    expect(serializeMetadataLinkAnalytics(state)).toMatchObject({
      link_artist: false,
      link_album_artist: true,
      sync_track_numbers: true,
    });
  });
});
