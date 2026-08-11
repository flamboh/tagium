import type {
  AlbumGroup,
  AudioMetadata,
  SharePublication,
  TagiumFile,
} from "@/features/library/types";
import {
  projectAlbumManifest,
  projectTrackManifest,
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

export const fingerprintSharedContent = async (
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

const projectArtwork = (firstPicture: AudioMetadata["picture"][number] | undefined) => {
  const supportedPicture =
    firstPicture && (firstPicture.format === "image/jpeg" || firstPicture.format === "image/png")
      ? { ...firstPicture, format: firstPicture.format as "image/jpeg" | "image/png" }
      : undefined;
  const artwork: ManifestArtwork | undefined = supportedPicture
    ? {
        kind: "stored",
        format: supportedPicture.format,
        type: supportedPicture.type,
        description: supportedPicture.description,
      }
    : undefined;
  const cover = supportedPicture
    ? new File(
        [new Uint8Array(supportedPicture.data)],
        supportedPicture.format === "image/png" ? "cover.png" : "cover.jpg",
        { type: supportedPicture.format },
      )
    : null;
  return { artwork, cover, bytes: supportedPicture?.data };
};

export const projectAlbumShareSnapshot = async (
  album: AlbumGroup,
  files: readonly TagiumFile[],
): Promise<ShareSnapshot> => {
  const { artwork, cover, bytes } = projectArtwork(album.cover?.[0]);
  const manifest = projectAlbumManifest(album, files, artwork);
  return {
    manifest,
    cover,
    fingerprint: await fingerprintSharedContent(manifest, bytes),
  };
};

export const projectTrackShareSnapshot = async (file: TagiumFile): Promise<ShareSnapshot> => {
  const picture = file.pendingMetadataPatch?.picture ?? file.metadata?.picture;
  const { artwork, cover, bytes } = projectArtwork(picture?.[0]);
  const manifest = projectTrackManifest(file, artwork);
  return {
    manifest,
    cover,
    fingerprint: await fingerprintSharedContent(manifest, bytes),
  };
};

export interface ShareActionState {
  enabled: boolean;
  label:
    | "share album"
    | "share track"
    | "view share link"
    | "update shared album"
    | "update shared track";
  reason: string;
  variant: "create" | "view" | "update";
}

export const isActiveSharePublication = (
  publication: SharePublication | undefined,
  now = Date.now(),
) =>
  publication?.status === "active" &&
  Number.isFinite(Date.parse(publication.expiresAt)) &&
  Date.parse(publication.expiresAt) > now;

const shareActionState = (
  kind: Manifest["kind"],
  sourceManifestSlug: string | undefined,
  publication: SharePublication | undefined,
  currentFingerprint: string | undefined,
  hasCapability: boolean,
  now = Date.now(),
): ShareActionState => {
  const createLabel = kind === "album" ? "share album" : "share track";
  const updateLabel = kind === "album" ? "update shared album" : "update shared track";
  if (sourceManifestSlug) {
    return {
      enabled: true,
      label: "view share link",
      reason: "view share link",
      variant: "view",
    };
  }
  if (!publication)
    return { enabled: true, label: createLabel, reason: createLabel, variant: "create" };
  if (!isActiveSharePublication(publication, now)) {
    return {
      enabled: true,
      label: createLabel,
      reason: "create a new share link",
      variant: "create",
    };
  }
  if (!hasCapability) {
    return {
      enabled: false,
      label: updateLabel,
      reason: `this browser cannot update the shared ${kind}`,
      variant: "update",
    };
  }
  if (!currentFingerprint || currentFingerprint === publication.publishedFingerprint) {
    return {
      enabled: true,
      label: "view share link",
      reason: "view share link",
      variant: "view",
    };
  }
  return { enabled: true, label: updateLabel, reason: updateLabel, variant: "update" };
};

export const shareAlbumActionState = (
  album: AlbumGroup,
  currentFingerprint: string | undefined,
  hasCapability: boolean,
  now = Date.now(),
) =>
  shareActionState(
    "album",
    album.sourceManifestSlug,
    album.sharePublication,
    currentFingerprint,
    hasCapability,
    now,
  );

export const shareTrackActionState = (
  file: TagiumFile,
  currentFingerprint: string | undefined,
  hasCapability: boolean,
  now = Date.now(),
) =>
  shareActionState(
    "track",
    file.sourceManifestSlug,
    file.sharePublication,
    currentFingerprint,
    hasCapability,
    now,
  );
