import { describe, expect, it } from "vite-plus/test";
import { shouldApplySoundCloudSetCoverToTracks } from "./soundcloudSet";

describe("soundcloud set cover writes", () => {
  it("applies covers to tracks for SoundCloud albums when enabled", () => {
    expect(
      shouldApplySoundCloudSetCoverToTracks(
        { isAlbum: true },
        { applySoundCloudAlbumCoverToTracks: true },
      ),
    ).toBe(true);
  });

  it("does not apply covers to tracks for SoundCloud playlists", () => {
    expect(
      shouldApplySoundCloudSetCoverToTracks(
        { isAlbum: false },
        { applySoundCloudAlbumCoverToTracks: true },
      ),
    ).toBe(false);
  });

  it("does not apply covers to tracks when the album setting is off", () => {
    expect(
      shouldApplySoundCloudSetCoverToTracks(
        { isAlbum: true },
        { applySoundCloudAlbumCoverToTracks: false },
      ),
    ).toBe(false);
  });
});
