import { describe, expect, it, vi } from "vite-plus/test";
import {
  fetchSharedAlbum,
  revokeSharedAlbum,
  SharedAlbumUnavailableError,
  SharedAlbumVersionError,
} from "@/features/share/shareClient";

const manifest = {
  version: 1,
  kind: "album",
  album: { title: "Signal", artist: "June", genre: "Electronic" },
  tracks: [
    {
      sourceUrl: "https://soundcloud.com/june/signal",
      audioBitrate: "320",
      metadata: {
        filename: "01-signal",
        title: "Signal",
        artist: "June",
        album: "Signal",
        genre: "Electronic",
        trackNumber: 1,
      },
    },
  ],
};

describe("shared album client", () => {
  it("decodes the public response envelope without requesting audio", async () => {
    const fetch = vi.fn(async () => Response.json({ manifest, expiresAt: "2026-10-20T12:00:00Z" }));
    await expect(fetchSharedAlbum("AbcdEFGHijklmno_123-45", { fetch })).resolves.toEqual({
      manifest,
      expiresAt: "2026-10-20T12:00:00Z",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/manifests/AbcdEFGHijklmno_123-45",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("distinguishes a future contract from a generic unavailable response", async () => {
    const futureFetch = vi.fn(async () =>
      Response.json({ manifest: { ...manifest, version: 2 }, expiresAt: "2026-10-20T12:00:00Z" }),
    );
    await expect(
      fetchSharedAlbum("AbcdEFGHijklmno_123-45", { fetch: futureFetch }),
    ).rejects.toBeInstanceOf(SharedAlbumVersionError);
    const missingFetch = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      fetchSharedAlbum("AbcdEFGHijklmno_123-45", { fetch: missingFetch }),
    ).rejects.toBeInstanceOf(SharedAlbumUnavailableError);
  });

  it("sends the private revocation permission only in the delete authorization header", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }),
    );
    await revokeSharedAlbum("AbcdEFGHijklmno_123-45", "private-secret", { fetch });
    const [url, request] = fetch.mock.calls[0]!;
    expect(url).not.toContain("private-secret");
    expect(request).toEqual(
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({ Authorization: "Bearer private-secret" }),
      }),
    );
  });

  it("accepts only a 204 revocation response", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      revokeSharedAlbum("AbcdEFGHijklmno_123-45", "private-secret", { fetch }),
    ).rejects.toThrow("sharing could not be stopped");
  });
});
