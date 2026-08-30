import { describe, expect, it } from "vite-plus/test";
import interSemiBoldDataUrl from "@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf?inline";
import {
  renderShareSocialCardPng,
  renderShareSocialCardSvg,
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

  it("uses the favicon when corrupt artwork has a valid image signature", async () => {
    const corruptPng = new Uint8Array(24);
    corruptPng.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const fallback = await renderShareSocialCardPng(manifest, undefined, testFont);
    const png = await renderShareSocialCardPng(
      manifest,
      { bytes: corruptPng, type: "image/png" },
      testFont,
    );

    expect(png).toEqual(fallback);
  });

  it("makes unsupported scripts and emoji visible instead of silently dropping glyphs", () => {
    const svg = renderShareSocialCardSvg({
      ...manifest,
      album: { ...manifest.album, title: "東京 عربي 🎵 · café Ạ ᾈ € ™ Ж" },
    });

    expect(svg).toContain("□");
    expect(svg).toContain("café Ạ ᾈ € ™ Ж");
    expect(svg).toContain("Artist");
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
