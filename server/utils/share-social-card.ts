import { Resvg } from "@cf-wasm/resvg";
import faviconSvg from "../../public/favicon.svg?raw";
import { manifestTrackCount, type Manifest } from "../../src/features/share/shareManifest";

export const SHARE_SOCIAL_CARD_WIDTH = 1_200;
export const SHARE_SOCIAL_CARD_HEIGHT = 630;
export const SATOSHI_STYLESHEET_URL =
  "https://api.fontshare.com/v2/css?f%5B%5D=satoshi%401&display=swap";

const ARTWORK_SIZE = 630;
const CONTENT_LEFT = 690;
const CONTENT_WIDTH = 458;

// Exact sRGB equivalents of the light theme tokens in src/index.css.
const colors = {
  background: "#fbf8f8",
  foreground: "#1c1514",
  mutedForeground: "#665b59",
  primary: "#900f1a",
} as const;

export type ShareSocialCardArtwork = {
  bytes: Uint8Array;
  type: "image/jpeg" | "image/png";
};

type FetchFont = (input: string | URL) => Promise<Response>;

/** Load Satoshi through Fontshare's API without redistributing its proprietary font file. */
export const createSatoshiFontLoader = (fetchFont: FetchFont = fetch) => {
  let fontPromise: Promise<Uint8Array> | undefined;
  return () => {
    fontPromise ??= (async () => {
      const stylesheet = await fetchFont(SATOSHI_STYLESHEET_URL);
      if (!stylesheet.ok) throw new Error("satoshi_stylesheet_unavailable");
      const source = (await stylesheet.text()).match(
        /url\(['"]?([^'")]+\.ttf)['"]?\)\s*format\(['"]truetype['"]\)/u,
      )?.[1];
      if (!source) throw new Error("satoshi_font_source_missing");

      const font = await fetchFont(new URL(source, SATOSHI_STYLESHEET_URL));
      if (!font.ok) throw new Error("satoshi_font_unavailable");
      return new Uint8Array(await font.arrayBuffer());
    })().catch((error: unknown) => {
      fontPromise = undefined;
      throw error;
    });
    return fontPromise;
  };
};

const loadSatoshiFont = createSatoshiFontLoader();

const cleanText = (value: string) =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const validXmlCharacter =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    return validXmlCharacter ? character : " ";
  })
    .join("")
    .replaceAll(/\s+/g, " ")
    .trim();

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const approximateTextWidth = (value: string, fontSize: number) => {
  let units = 0;
  for (const character of value) {
    if (/\s/u.test(character)) units += 0.32;
    else if (/[ilI1.,'`:;|!]/u.test(character)) units += 0.3;
    else if (/[MW@#%&]/u.test(character)) units += 0.88;
    else if (/\p{Lu}/u.test(character)) units += 0.69;
    else if (/\p{Script=Han}|\p{Emoji_Presentation}/u.test(character)) units += 1;
    else units += 0.56;
  }
  return units * fontSize;
};

const truncateLine = (value: string, maximumWidth: number, fontSize: number) => {
  const characters = Array.from(value);
  while (
    characters.length > 0 &&
    approximateTextWidth(`${characters.join("")}…`, fontSize) > maximumWidth
  ) {
    characters.pop();
  }
  return `${characters.join("").trimEnd()}…`;
};

const wrapText = (value: string, maximumWidth: number, fontSize: number, maximumLines: number) => {
  const words = cleanText(value).split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";

  const pushLine = () => {
    if (line) lines.push(line);
    line = "";
  };

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (approximateTextWidth(candidate, fontSize) <= maximumWidth) {
      line = candidate;
      continue;
    }

    pushLine();
    if (lines.length === maximumLines) {
      lines[maximumLines - 1] = truncateLine(
        `${lines[maximumLines - 1]} ${word}`,
        maximumWidth,
        fontSize,
      );
      return { lines, truncated: true };
    }

    if (approximateTextWidth(word, fontSize) <= maximumWidth) {
      line = word;
      continue;
    }

    for (const character of word) {
      const fragment = `${line}${character}`;
      if (approximateTextWidth(fragment, fontSize) <= maximumWidth) {
        line = fragment;
        continue;
      }
      pushLine();
      if (lines.length === maximumLines) {
        lines[maximumLines - 1] = truncateLine(
          `${lines[maximumLines - 1]}${character}`,
          maximumWidth,
          fontSize,
        );
        return { lines, truncated: true };
      }
      line = character;
    }
  }

  pushLine();
  return { lines: lines.length > 0 ? lines : ["untitled"], truncated: false };
};

const titleLayout = (title: string) => {
  for (const fontSize of [64, 58, 52, 48, 44] as const) {
    const wrapped = wrapText(title, CONTENT_WIDTH, fontSize, 4);
    if (!wrapped.truncated && (wrapped.lines.length <= 3 || fontSize === 44)) {
      return { ...wrapped, fontSize };
    }
  }
  return { ...wrapText(title, CONTENT_WIDTH, 44, 4), fontSize: 44 };
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
};

const fallbackArtworkMarkup = faviconSvg.replace(
  "<svg ",
  `<svg x="0" y="0" width="${ARTWORK_SIZE}" height="${ARTWORK_SIZE}" `,
);

const artworkMarkup = (artwork: ShareSocialCardArtwork | undefined) =>
  artwork
    ? `<image x="0" y="0" width="${ARTWORK_SIZE}" height="${ARTWORK_SIZE}" href="data:${artwork.type};base64,${bytesToBase64(
        artwork.bytes,
      )}" preserveAspectRatio="xMidYMid slice" />`
    : fallbackArtworkMarkup;

/** Build the deterministic SVG that is rasterized for X's large-image card. */
export const renderShareSocialCardSvg = (manifest: Manifest, artwork?: ShareSocialCardArtwork) => {
  const content =
    manifest.kind === "album"
      ? {
          title: cleanText(manifest.album.title) || "untitled album",
          artist: cleanText(manifest.album.artist) || "unknown artist",
          detail: `${manifestTrackCount(manifest)} ${
            manifestTrackCount(manifest) === 1 ? "track" : "tracks"
          } · shared on tagium`,
        }
      : {
          title: cleanText(manifest.track.metadata.title) || "untitled track",
          artist: cleanText(manifest.track.metadata.artist) || "unknown artist",
          detail: "shared track on tagium",
        };
  const title = titleLayout(content.title);
  const lineHeight = Math.round(title.fontSize * 1.1);
  const artistFontSize = approximateTextWidth(content.artist, 36) <= CONTENT_WIDTH ? 36 : 34;
  const artist =
    approximateTextWidth(content.artist, artistFontSize) <= CONTENT_WIDTH
      ? content.artist
      : truncateLine(content.artist, CONTENT_WIDTH, artistFontSize);
  const detailFontSize =
    ([30, 28] as const).find(
      (fontSize) => approximateTextWidth(content.detail, fontSize) <= CONTENT_WIDTH,
    ) ?? 27;
  const detail =
    approximateTextWidth(content.detail, detailFontSize) <= CONTENT_WIDTH
      ? content.detail
      : truncateLine(content.detail, CONTENT_WIDTH, detailFontSize);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_SOCIAL_CARD_WIDTH}" height="${SHARE_SOCIAL_CARD_HEIGHT}" viewBox="0 0 ${SHARE_SOCIAL_CARD_WIDTH} ${SHARE_SOCIAL_CARD_HEIGHT}">
  <rect width="1200" height="630" fill="${colors.background}" />
  ${artworkMarkup(artwork)}
  <rect x="630" width="570" height="630" fill="${colors.background}" />
  <rect x="630" width="8" height="630" fill="${colors.primary}" />
  <g font-family="Satoshi Variable" font-weight="600" font-feature-settings="'ss01' 1">
    <text x="${CONTENT_LEFT}" y="102" font-size="34" fill="${colors.primary}">tagium</text>
    ${title.lines
      .map(
        (line, index) =>
          `<text x="${CONTENT_LEFT}" y="${144 + index * lineHeight}" dominant-baseline="hanging" font-size="${title.fontSize}" letter-spacing="-1.2" fill="${colors.foreground}">${escapeXml(line)}</text>`,
      )
      .join("\n    ")}
    <text x="${CONTENT_LEFT}" y="432" font-size="${artistFontSize}" fill="${colors.mutedForeground}">${escapeXml(artist)}</text>
    <rect x="${CONTENT_LEFT}" y="468" width="64" height="4" rx="2" fill="${colors.primary}" />
    <text x="${CONTENT_LEFT}" y="530" font-size="${detailFontSize}" fill="${colors.primary}">${escapeXml(detail)}</text>
  </g>
</svg>`;
};

/** Rasterize a social card to the PNG format accepted by X's link crawler. */
export const renderShareSocialCardPng = async (
  manifest: Manifest,
  artwork?: ShareSocialCardArtwork,
  fontBytes?: Uint8Array,
) => {
  const satoshi = fontBytes ?? (await loadSatoshiFont());
  const rasterize = async (candidate: ShareSocialCardArtwork | undefined) => {
    const renderer = await Resvg.async(renderShareSocialCardSvg(manifest, candidate), {
      font: {
        fontBuffers: [satoshi],
        defaultFontFamily: "Satoshi Variable",
        loadSystemFonts: false,
      },
      fitTo: { mode: "original" },
    });
    return renderer.render().asPng();
  };

  if (!artwork) return rasterize(undefined);
  try {
    return await rasterize(artwork);
  } catch {
    return rasterize(undefined);
  }
};
