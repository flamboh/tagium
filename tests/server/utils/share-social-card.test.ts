import { describe, expect, it } from "vite-plus/test";
import interSemiBoldDataUrl from "@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf?inline";
import {
  createSatoshiFontLoader,
  renderShareSocialCardPng,
  renderShareSocialCardSvg,
  SATOSHI_STYLESHEET_URL,
  SHARE_SOCIAL_CARD_HEIGHT,
  SHARE_SOCIAL_CARD_WIDTH,
} from "../../../server/utils/share-social-card";
import type { Manifest } from "../../../src/features/share/shareManifest";

const manifest = {
  version: 1,
  kind: "album",
  album: {
    title: "Album & <Deluxe>",
    artist: "Artist",
    genre: "Genre",
  },
  tracks: [
    {
      sourceUrl: "https://example.com/track",
      audioBitrate: "320",
      metadata: {
        filename: "track",
        title: "Track",
        artist: "Artist",
        album: "Album",
        genre: "Genre",
      },
    },
  ],
} satisfies Manifest;

const decodeDataUrl = (dataUrl: string) => {
  const separator = dataUrl.indexOf(",");
  return Uint8Array.from(atob(dataUrl.slice(separator + 1)), (character) =>
    character.charCodeAt(0),
  );
};

const testFont = decodeDataUrl(interSemiBoldDataUrl);

describe("share social cards", () => {
  it("lays out escaped share content in the artwork-first card template", () => {
    const svg = renderShareSocialCardSvg(manifest);

    expect(svg).toContain(`width="${SHARE_SOCIAL_CARD_WIDTH}"`);
    expect(svg).toContain(`height="${SHARE_SOCIAL_CARD_HEIGHT}"`);
    expect(svg).toContain('<rect x="630" width="8" height="630" fill="#900f1a" />');
    expect(svg).toContain('<svg x="0" y="0" width="630" height="630"');
    expect(svg).toContain('<rect width="64" height="64" rx="4" fill="#900f1a" />');
    expect(svg).toContain('font-size="34" fill="#900f1a">tagium</text>');
    expect(svg).toContain('font-size="36" fill="#665b59">Artist</text>');
    expect(svg).toContain('font-size="30" fill="#900f1a">1 track · shared on tagium</text>');
    expect(svg).toContain("Album &amp;");
    expect(svg).toContain("&lt;Deluxe&gt;");
    expect(svg).toContain("Artist");
    expect(svg).toContain("1 track · shared on tagium");
    expect(svg).not.toContain("Album & <Deluxe>");
  });

  it("rasterizes the template into a 1200 by 630 PNG", async () => {
    const png = await renderShareSocialCardPng(manifest, undefined, testFont);

    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(SHARE_SOCIAL_CARD_WIDTH);
    expect(view.getUint32(20)).toBe(SHARE_SOCIAL_CARD_HEIGHT);
  });

  it("still renders a PNG when supplied artwork cannot be decoded", async () => {
    const png = await renderShareSocialCardPng(
      manifest,
      { bytes: Uint8Array.of(1, 2, 3), type: "image/png" },
      testFont,
    );

    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("loads and reuses Satoshi from Fontshare's official stylesheet", async () => {
    const requests: string[] = [];
    const fontBytes = Uint8Array.of(1, 2, 3);
    const loadSatoshi = createSatoshiFontLoader(async (input) => {
      requests.push(String(input));
      return requests.length === 1
        ? new Response(
            "@font-face { src: url('//cdn.fontshare.test/satoshi.ttf') format('truetype'); }",
          )
        : new Response(fontBytes.buffer);
    });

    await expect(loadSatoshi()).resolves.toEqual(fontBytes);
    await expect(loadSatoshi()).resolves.toEqual(fontBytes);
    expect(requests).toEqual([SATOSHI_STYLESHEET_URL, "https://cdn.fontshare.test/satoshi.ttf"]);
  });

  it("truncates long unbroken titles without overflowing the text column", () => {
    const longTitle = "a".repeat(500);
    const svg = renderShareSocialCardSvg({
      ...manifest,
      album: { ...manifest.album, title: longTitle },
    });

    expect(svg).toContain("…");
    expect(svg).not.toContain(longTitle);
  });
});
