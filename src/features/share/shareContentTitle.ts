import type { Manifest } from "./shareManifest";

export const MAX_CONTENT_TITLE_LENGTH = 200;

export const isSafeContentTitleCharacter = (character: string) => {
  const code = character.charCodeAt(0);

  return code > 31 && code !== 127;
};

export const normalizeContentTitle = (title: string) => {
  const normalized = Array.from(title, (character) =>
    isSafeContentTitleCharacter(character) ? character : " ",
  )
    .join("")
    .trim();

  return normalized
    ? Array.from(normalized).slice(0, MAX_CONTENT_TITLE_LENGTH).join("")
    : undefined;
};

export const manifestContentTitle = (manifest: Manifest) => {
  const title = manifest.kind === "album" ? manifest.album.title : manifest.track.metadata.title;

  return title.trim() || `untitled ${manifest.kind}`;
};
