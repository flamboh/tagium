import { Resvg } from "@cf-wasm/resvg";
import interSemiBoldDataUrl from "@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf?inline";
import faviconSvg from "../../public/favicon.svg?raw";
import { manifestTrackCount, type Manifest } from "../../src/features/share/shareManifest";
import { isShareArtworkBytes } from "./share-manifest";

export const SHARE_SOCIAL_CARD_WIDTH = 1_200;
export const SHARE_SOCIAL_CARD_HEIGHT = 630;
export const SATOSHI_STYLESHEET_URL =
  "https://api.fontshare.com/v2/css?f%5B%5D=satoshi%401&display=swap";
export const SATOSHI_LOAD_TIMEOUT_MS = 3_000;
export const SATOSHI_STYLESHEET_MAX_BYTES = 64 * 1024;
export const SATOSHI_FONT_MAX_BYTES = 2 * 1024 * 1024;

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

type FetchFont = (input: string | URL, init?: RequestInit) => Promise<Response>;

const readBoundedResponse = async (response: Response, maximumBytes: number) => {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("font_response_too_large");
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error("font_response_too_large");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    size += result.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new Error("font_response_too_large");
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const fetchBounded = async (
  fetchFont: FetchFont,
  input: string | URL,
  maximumBytes: number,
  signal: AbortSignal,
) => {
  const response = await fetchFont(input, { signal });
  if (!response.ok) throw new Error("font_response_unavailable");
  return readBoundedResponse(response, maximumBytes);
};

/** Load Satoshi through Fontshare's API without redistributing its proprietary font file. */
export const createSatoshiFontLoader = (
  fetchFont: FetchFont = fetch,
  timeoutMs = SATOSHI_LOAD_TIMEOUT_MS,
) => {
  let fontPromise: Promise<Uint8Array> | undefined;
  return () => {
    fontPromise ??= (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const source = new TextDecoder()
          .decode(
            await fetchBounded(
              fetchFont,
              SATOSHI_STYLESHEET_URL,
              SATOSHI_STYLESHEET_MAX_BYTES,
              controller.signal,
            ),
          )
          .match(/url\(['"]?([^'")]+\.ttf)['"]?\)\s*format\(['"]truetype['"]\)/u)?.[1];
        if (!source) throw new Error("satoshi_font_source_missing");

        const font = await fetchBounded(
          fetchFont,
          new URL(source, SATOSHI_STYLESHEET_URL),
          SATOSHI_FONT_MAX_BYTES,
          controller.signal,
        );
        if (
          font.length < 4 ||
          font[0] !== 0x00 ||
          font[1] !== 0x01 ||
          font[2] !== 0x00 ||
          font[3] !== 0x00
        ) {
          throw new Error("satoshi_font_invalid");
        }
        return font;
      } finally {
        clearTimeout(timeout);
      }
    })().catch((error: unknown) => {
      fontPromise = undefined;
      throw error;
    });
    return fontPromise;
  };
};

const loadSatoshiFont = createSatoshiFontLoader();

const decodeDataUrl = (dataUrl: string) => {
  const separator = dataUrl.indexOf(",");
  return Uint8Array.from(atob(dataUrl.slice(separator + 1)), (character) =>
    character.charCodeAt(0),
  );
};

// Inter is bundled under the SIL Open Font License as a deterministic fallback. It supplies Greek
// and Cyrillic glyphs missing from Satoshi and keeps rendering available when Fontshare is down.
// Unsupported scripts and emoji become a visible square instead of disappearing in a Worker.
export const BUNDLED_FALLBACK_FONT = decodeDataUrl(interSemiBoldDataUrl);
let defaultFontPromise: Promise<Uint8Array> | undefined;
export const loadShareCardFont = (fetchFont?: FetchFont) => {
  if (fetchFont) {
    return createSatoshiFontLoader(fetchFont)().catch(() => BUNDLED_FALLBACK_FONT);
  }
  return (defaultFontPromise ??= loadSatoshiFont().catch(() => BUNDLED_FALLBACK_FONT));
};

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
    if (!validXmlCharacter) return " ";
    const supported =
      codePoint <= 0x024f ||
      (codePoint >= 0x0300 && codePoint <= 0x036f) ||
      (codePoint >= 0x0370 && codePoint <= 0x052f) ||
      (codePoint >= 0x1e00 && codePoint <= 0x1fff) ||
      (codePoint >= 0x2000 && codePoint <= 0x218f);
    return supported ? character : "□";
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
  <g font-family="'Satoshi Variable', Inter" font-weight="600" font-feature-settings="'ss01' 1">
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
  const satoshi = fontBytes ?? (await loadShareCardFont());
  const rasterize = async (candidate: ShareSocialCardArtwork | undefined) => {
    const fontBuffers =
      satoshi === BUNDLED_FALLBACK_FONT
        ? [BUNDLED_FALLBACK_FONT]
        : [satoshi, BUNDLED_FALLBACK_FONT];
    const renderer = await Resvg.async(renderShareSocialCardSvg(manifest, candidate), {
      font: {
        fontBuffers,
        defaultFontFamily: "Satoshi Variable",
        loadSystemFonts: false,
      },
      fitTo: { mode: "original" },
    });
    return renderer.render().asPng();
  };

  if (!artwork) return rasterize(undefined);
  if (!isShareArtworkBytes(artwork.bytes, artwork.type)) return rasterize(undefined);
  try {
    return await rasterize(artwork);
  } catch (error) {
    if (!isArtworkDecodeError(error)) throw error;
    return rasterize(undefined);
  }
};

const isArtworkDecodeError = (error: unknown) =>
  error instanceof Error &&
  /art|image|png|jpeg|decode|parse|invalid|unsupported/iu.test(error.message);
