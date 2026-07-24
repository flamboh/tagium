import type { AlbumGroup, TagiumFile } from "@/features/library/types";
import {
  projectAlbumManifest,
  type Manifest,
  type ManifestArtwork,
} from "@/features/share/shareManifest";

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

export const fingerprintSharedAlbum = async (
  manifest: Manifest,
  artworkBytes?: Uint8Array<ArrayBuffer>,
) => {
  const metadata = new TextEncoder().encode(canonicalJson(manifest));
  const separator = new Uint8Array([0]);
  const payload = new Uint8Array(metadata.byteLength + 1 + (artworkBytes?.byteLength ?? 0));
  payload.set(metadata);
  payload.set(separator, metadata.byteLength);
  if (artworkBytes) payload.set(artworkBytes, metadata.byteLength + 1);
  return hex(await crypto.subtle.digest("SHA-256", payload));
};

export interface ShareSnapshot {
  manifest: Manifest;
  cover: File | null;
  fingerprint: string;
}

export const projectShareSnapshot = async (
  album: AlbumGroup,
  files: readonly TagiumFile[],
): Promise<ShareSnapshot> => {
  const firstPicture = album.cover?.[0];
  const supportedCover =
    firstPicture && (firstPicture.format === "image/jpeg" || firstPicture.format === "image/png")
      ? { ...firstPicture, format: firstPicture.format as "image/jpeg" | "image/png" }
      : undefined;
  const artwork: ManifestArtwork | undefined = supportedCover
    ? {
        kind: "stored",
        format: supportedCover.format,
        type: supportedCover.type,
        description: supportedCover.description,
      }
    : undefined;
  const manifest = projectAlbumManifest(album, files, artwork);
  const cover = supportedCover
    ? new File(
        [new Uint8Array(supportedCover.data)],
        supportedCover.format === "image/png" ? "cover.png" : "cover.jpg",
        { type: supportedCover.format },
      )
    : null;
  return {
    manifest,
    cover,
    fingerprint: await fingerprintSharedAlbum(manifest, supportedCover?.data),
  };
};

export interface ShareAlbumActionState {
  enabled: boolean;
  label: "share album" | "view share link" | "update shared album";
  reason: string;
}

export const isActiveSharePublication = (
  publication: AlbumGroup["sharePublication"],
  now = Date.now(),
) =>
  publication?.status === "active" &&
  Number.isFinite(Date.parse(publication.expiresAt)) &&
  Date.parse(publication.expiresAt) > now;

export const shareAlbumActionState = (
  album: AlbumGroup,
  currentFingerprint: string | undefined,
  hasCapability: boolean,
  now = Date.now(),
): ShareAlbumActionState => {
  if (album.sourceManifestSlug) {
    return { enabled: true, label: "view share link", reason: "view share link" };
  }
  const publication = album.sharePublication;
  if (!publication) return { enabled: true, label: "share album", reason: "share album" };
  if (!isActiveSharePublication(publication, now)) {
    return { enabled: true, label: "share album", reason: "create a new share link" };
  }
  if (!hasCapability) {
    return {
      enabled: false,
      label: "update shared album",
      reason: "this browser cannot update the shared album",
    };
  }
  if (!currentFingerprint || currentFingerprint === publication.publishedFingerprint) {
    return { enabled: true, label: "view share link", reason: "view share link" };
  }
  return { enabled: true, label: "update shared album", reason: "update shared album" };
};
