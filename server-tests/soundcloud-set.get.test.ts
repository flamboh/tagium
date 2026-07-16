import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import handler from "../server/api/soundcloud-set.get";

const makeEvent = () => {
  const request = new Request(
    "https://tagium.test/api/soundcloud-set?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Fsets%2Falbum",
  );

  return { req: request } as unknown as Parameters<typeof handler>[0];
};

describe("soundcloud set endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns album kind and prefers release date for album year", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        let url = "";
        if (input instanceof Request) {
          url = input.url;
        } else {
          url = new URL(input).toString();
        }

        if (url === "https://soundcloud.com/") {
          return new Response(
            '<script>window.__sc_version="1234567890"</script>{"hydratable":"apiClient","data":{"id":"client-id"}}',
          );
        }

        expect(url).toContain("https://api-v2.soundcloud.com/resolve");

        return Response.json({
          kind: "playlist",
          title: " Album ",
          future_playlist_field: { is: "ignored" },
          genre: " Electronic ",
          display_date: "2024-05-01T00:00:00Z",
          release_date: "2023-09-15T00:00:00Z",
          is_album: true,
          set_type: "album",
          artwork_url: "https://i1.sndcdn.com/artworks-large.jpg",
          user: {
            username: " Artist ",
          },
          tracks: [
            {
              id: 1,
              kind: "track",
              title: " Track ",
              permalink_url: "https://soundcloud.com/artist/track",
              duration: 123,
              future_track_field: true,
            },
          ],
        });
      }),
    );

    await expect(handler(makeEvent())).resolves.toMatchObject({
      title: "Album",
      artist: "Artist",
      genre: "Electronic",
      year: 2023,
      isAlbum: true,
      coverUrl: "https://i1.sndcdn.com/artworks-t1080x1080.jpg",
      tracks: [
        {
          title: "Track",
          url: "https://soundcloud.com/artist/track",
          duration: 123,
          trackNumber: 1,
        },
      ],
    });
  });

  it("accepts null release date for playlist year", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        let url = "";
        if (input instanceof Request) {
          url = input.url;
        } else {
          url = new URL(input).toString();
        }

        if (url === "https://soundcloud.com/") {
          return new Response(
            '<script>window.__sc_version="1234567890"</script>{"hydratable":"apiClient","data":{"id":"client-id"}}',
          );
        }

        expect(url).toContain("https://api-v2.soundcloud.com/resolve");

        return Response.json({
          kind: "playlist",
          title: " Playlist ",
          genre: " Electronic ",
          display_date: "2024-05-01T00:00:00Z",
          release_date: null,
          is_album: false,
          set_type: "playlist",
          artwork_url: null,
          user: {
            username: " Artist ",
          },
          tracks: [
            {
              id: 1,
              kind: "track",
              title: " Track ",
              permalink_url: "https://soundcloud.com/artist/track",
              duration: 123,
            },
          ],
        });
      }),
    );

    await expect(handler(makeEvent())).resolves.toMatchObject({
      title: "Playlist",
      artist: "Artist",
      genre: "Electronic",
      year: 2024,
      isAlbum: false,
      tracks: [
        {
          title: "Track",
          url: "https://soundcloud.com/artist/track",
          duration: 123,
          trackNumber: 1,
        },
      ],
    });
  });
});
