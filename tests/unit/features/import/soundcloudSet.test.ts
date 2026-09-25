import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveSoundCloudSet } from "@/features/import/soundcloudSet";

describe("resolveSoundCloudSet", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects decoded tracks with malformed URLs", async () => {
    vi.stubGlobal("window", {
      location: {
        origin: "https://tagium.test",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          title: "Imported Set",
          artist: "Set Artist",
          genre: "Electronic",
          isAlbum: true,
          tracks: [
            {
              title: "Broken Track",
              url: "not-a-url",
              trackNumber: 1,
            },
          ],
        }),
      ),
    );

    await expect(resolveSoundCloudSet("https://soundcloud.com/artist/sets/set")).rejects.toThrow();
  });
});
