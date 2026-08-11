import { Resvg } from "@cf-wasm/resvg";
import interSemiBoldDataUrl from "@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf?inline";
import { manifestTrackCount, type Manifest } from "../../src/features/share/shareManifest";

export const SHARE_SOCIAL_CARD_WIDTH = 1_200;
export const SHARE_SOCIAL_CARD_HEIGHT = 630;

export type ShareSocialCardArtwork = {
  bytes: Uint8Array;
  type: "image/jpeg" | "image/png";
};

const decodeDataUrl = (dataUrl: string) => {
  const separator = dataUrl.indexOf(",");
  if (separator === -1 || !dataUrl.slice(0, separator).endsWith(";base64")) {
    throw new Error("invalid_inline_font");
  }
  return Uint8Array.from(atob(dataUrl.slice(separator + 1)), (character) =>
    character.charCodeAt(0),
  );
};

const interSemiBold = decodeDataUrl(interSemiBoldDataUrl);

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
  for (const fontSize of [64, 58, 52] as const) {
    const wrapped = wrapText(title, 498, fontSize, 3);
    if (!wrapped.truncated) return { ...wrapped, fontSize };
  }
  return { ...wrapText(title, 498, 46, 3), fontSize: 46 };
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
};

const artworkMarkup = (artwork: ShareSocialCardArtwork | undefined) =>
  artwork
    ? `<image x="72" y="72" width="486" height="486" href="data:${artwork.type};base64,${bytesToBase64(
        artwork.bytes,
      )}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover)" />`
    : `<rect x="72" y="72" width="486" height="486" rx="16" fill="#efe2e3" />
       <g transform="translate(205 187) scale(12)" fill="none" stroke="#900f1a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
         <circle cx="8" cy="18" r="4" />
         <path d="M12 18V2l7 4" />
       </g>`;

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
  const lineHeight = Math.round(title.fontSize * 1.08);
  const titleHeight = title.lines.length * lineHeight;
  const titleTop = Math.round(270 - titleHeight / 2);
  const artist =
    approximateTextWidth(content.artist, 31) <= 498
      ? content.artist
      : truncateLine(content.artist, 498, 31);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_SOCIAL_CARD_WIDTH}" height="${SHARE_SOCIAL_CARD_HEIGHT}" viewBox="0 0 ${SHARE_SOCIAL_CARD_WIDTH} ${SHARE_SOCIAL_CARD_HEIGHT}">
  <defs>
    <clipPath id="cover"><rect x="72" y="72" width="486" height="486" rx="16" /></clipPath>
    <filter id="cover-shadow" x="36" y="44" width="558" height="558" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#2b171a" flood-opacity="0.2" />
    </filter>
  </defs>
  <rect width="1200" height="630" fill="#fbf8f7" />
  <circle cx="1130" cy="620" r="360" fill="#900f1a" opacity="0.055" />
  <rect width="1200" height="10" fill="#900f1a" />
  <rect x="72" y="72" width="486" height="486" rx="16" fill="#e8dddc" filter="url(#cover-shadow)" />
  ${artworkMarkup(artwork)}
  <g font-family="Inter" font-weight="600">
    <text x="630" y="92" font-size="30" fill="#900f1a">tagium</text>
    ${title.lines
      .map(
        (line, index) =>
          `<text x="630" y="${titleTop + index * lineHeight}" dominant-baseline="hanging" font-size="${title.fontSize}" letter-spacing="-1.2" fill="#282124">${escapeXml(line)}</text>`,
      )
      .join("\n    ")}
    <text x="630" y="405" font-size="31" fill="#75696c">${escapeXml(artist)}</text>
    <text x="630" y="505" font-size="23" fill="#900f1a">${escapeXml(content.detail)}</text>
  </g>
</svg>`;
};

/** Rasterize a social card to the PNG format accepted by X's link crawler. */
export const renderShareSocialCardPng = async (
  manifest: Manifest,
  artwork?: ShareSocialCardArtwork,
) => {
  const renderer = await Resvg.async(renderShareSocialCardSvg(manifest, artwork), {
    font: {
      fontBuffers: [interSemiBold],
      defaultFontFamily: "Inter",
      loadSystemFonts: false,
    },
    fitTo: { mode: "original" },
  });
  return renderer.render().asPng();
};
