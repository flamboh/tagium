import { describe, expect, it, vi } from "vite-plus/test";
import { mockEvent } from "nitro/h3";
import { createShareLinkPreviewMiddleware } from "../../../server/middleware/03-share-link-preview";
import {
  buildShareLinkPreviewMetadata,
  injectShareLinkPreview,
  SHARE_LINK_PREVIEW_END,
  SHARE_LINK_PREVIEW_START,
} from "../../../server/utils/share-link-preview";
import type { Manifest } from "../../../src/features/share/shareManifest";

const track = {
  sourceUrl: "https://youtu.be/dQw4w9WgXcQ",
  audioBitrate: "320" as const,
  metadata: {
    filename: "track",
    title: "Track",
    artist: "Artist",
    album: "Album",
    genre: "Genre",
  },
};

const albumManifest = {
  version: 1,
  kind: "album",
  album: {
    title: "Album & <Deluxe>",
    artist: "Artist",
    genre: "Genre",
    artwork: {
      kind: "stored",
      format: "image/png",
      type: 3,
      description: "album cover",
    },
  },
  tracks: [track, track],
} satisfies Manifest;

const staticHtml = `<!doctype html><html><head>
${SHARE_LINK_PREVIEW_START}
<title>tagium</title>
<meta property="og:title" content="tagium" />
${SHARE_LINK_PREVIEW_END}
</head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>`;

describe("share link previews", () => {
  it("projects album content and stored artwork into absolute preview metadata", () => {
    expect(
      buildShareLinkPreviewMetadata(
        albumManifest,
        "abc234",
        "https://tagium.app/share/abc234?utm_source=test",
      ),
    ).toEqual({
      title: "Album & <Deluxe>",
      description: "Artist · 2 tracks · shared on tagium",
      url: "https://tagium.app/share/abc234",
      image: {
        url: "https://tagium.app/api/manifests/abc234/artwork",
        type: "image/png",
        alt: "Album & <Deluxe> cover",
      },
    });
  });

  it("uses track and artwork fallbacks without inventing shared content", () => {
    const manifest = {
      version: 1,
      kind: "track",
      track: {
        ...track,
        metadata: { ...track.metadata, title: "", artist: "" },
      },
    } satisfies Manifest;

    expect(
      buildShareLinkPreviewMetadata(manifest, "xyz789", "http://localhost:5173/share/xyz789"),
    ).toEqual({
      title: "untitled track",
      description: "unknown artist · shared track on tagium",
      url: "http://localhost:5173/share/xyz789",
      image: {
        url: "http://localhost:5173/icon-512.png",
        type: "image/png",
        alt: "tagium",
      },
    });
  });

  it("replaces only the marked static tags and escapes shared metadata", () => {
    const output = injectShareLinkPreview(
      staticHtml,
      buildShareLinkPreviewMetadata(albumManifest, "abc234", "https://tagium.app/share/abc234"),
    );

    expect(output).toContain("<title>Album &amp; &lt;Deluxe&gt; · tagium</title>");
    expect(output).toContain(
      '<meta property="og:image" content="https://tagium.app/api/manifests/abc234/artwork" />',
    );
    expect(output).toContain('<meta name="twitter:card" content="summary" />');
    expect(output).toContain(
      '<meta name="twitter:image:alt" content="Album &amp; &lt;Deluxe&gt; cover" />',
    );
    expect(output).not.toContain('<meta property="og:title" content="tagium" />');
    expect(output).toContain('<script src="/assets/app.js"></script>');
  });

  it("injects tags into the rendered SPA response and preserves response headers", async () => {
    const metadata = buildShareLinkPreviewMetadata(
      albumManifest,
      "abc234",
      "https://tagium.app/share/abc234",
    );
    const loadPreview = vi.fn(async () => metadata);
    const middleware = createShareLinkPreviewMiddleware(loadPreview);
    const rendered = new Response(staticHtml, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(staticHtml.length),
      },
    });
    const event = mockEvent("https://tagium.app/share/abc234");
    event.res.headers.set("x-robots-tag", "noindex, nofollow");

    const response = await middleware(event, async () => rendered);

    expect(loadPreview).toHaveBeenCalledWith(expect.any(Request), "abc234");
    expect(response).toBeInstanceOf(Response);
    if (!(response instanceof Response)) throw new Error("expected a response");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    await expect(response.text()).resolves.toContain(
      '<meta property="og:title" content="Album &amp; &lt;Deluxe&gt;" />',
    );
  });

  it("does not load metadata for malformed share paths", async () => {
    const loadPreview = vi.fn(async () => undefined);
    const middleware = createShareLinkPreviewMiddleware(loadPreview);
    const rendered = new Response(staticHtml, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });

    const response = await middleware(
      mockEvent("https://tagium.app/share/not-a-valid-slug"),
      async () => rendered,
    );

    expect(response).toBe(rendered);
    expect(loadPreview).not.toHaveBeenCalled();
  });
});
