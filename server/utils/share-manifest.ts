import {
  decodeManifest,
  type Manifest,
  type ManifestArtwork,
} from "../../src/features/share/shareManifest";

/**
 * The share-manifest module is the server seam for publishing, reading, and
 * revoking manifests. Callers do not learn SQL, R2 keys, expiry
 * arithmetic, token hashing, or compensation rules; tests swap its small
 * persistence adapter for a fake.
 */
export const SHARE_MANIFEST_LIFETIME_MS = 90 * 24 * 60 * 60 * 1_000;
export const SHARE_ARTWORK_MAX_BYTES = 5 * 1024 * 1024;
export const SHARE_ARTWORK_MAX_EDGE = 1_600;
export const SHARE_ARTWORK_MAX_PIXELS = 16_000_000;
export const SHARE_MANIFEST_MAX_BYTES = 256 * 1024;
export const SHARE_SLUG_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export type ShareManifest = Manifest;

export type ShareArtwork = {
  bytes: Uint8Array;
  type: "image/jpeg" | "image/png";
  sha256: string;
};

export type StoredShareManifest = {
  slug: string;
  version: number;
  payloadJson: string;
  artworkKey?: string;
  artworkType?: string;
  artworkBytes?: number;
  artworkSha256?: string;
  revocationTokenHash: string;
  trackCount: number;
  payloadBytes: number;
  status: "active" | "disabled";
  createdAt: number;
  expiresAt: number;
};

export interface ShareManifestPersistence {
  putArtwork: (input: {
    key: string;
    bytes: Uint8Array;
    type: ShareArtwork["type"];
    sha256: string;
    expiresAt: number;
  }) => Promise<void>;
  deleteArtwork: (key: string) => Promise<void>;
  getArtwork: (
    key: string,
  ) => Promise<
    { body: ReadableStream<Uint8Array>; type: string; size: number; sha256?: string } | undefined
  >;
  create: (record: StoredShareManifest) => Promise<"created" | "conflict">;
  get: (slug: string) => Promise<StoredShareManifest | undefined>;
  /** Atomically replaces an active record only if it still matches the loaded snapshot. */
  update: (input: {
    previous: StoredShareManifest;
    replacement: StoredShareManifest;
    revocationTokenHash: string;
    now: number;
  }) => Promise<"updated" | "conflict">;
  /** Returns a matching record even when it was already disabled, for retry-safe revoke. */
  disable: (
    slug: string,
    revocationTokenHash: string,
    now: number,
  ) => Promise<StoredShareManifest | undefined>;
}

export type ShareManifestUnavailable = { kind: "unavailable" };
export type ShareManifestLoaded = { kind: "available"; manifest: ShareManifest; expiresAt: number };
export type ShareManifestRevokeResult = "revoked" | "unavailable" | "artwork_unavailable";
export type ShareArtworkUpdate =
  | { kind: "retain" }
  | { kind: "remove" }
  | { kind: "replace"; artwork: ShareArtwork };
export type ShareManifestUpdateResult =
  | { kind: "updated"; slug: string; expiresAt: number }
  | ShareManifestUnavailable;
const unavailable = (): ShareManifestUnavailable => ({ kind: "unavailable" });

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const utf8 = new TextEncoder();
const nowMs = () => Date.now();
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer;

export const hashShareSecret = async (value: string) =>
  base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(utf8.encode(value)))),
  );

const randomToken = (bytes = 32) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64url(value);
};

export class ShareManifestValidationError extends Error {}
export const isShareManifestValidationError = (error: unknown) =>
  error instanceof ShareManifestValidationError;

export const parseShareArtwork = async (
  file: File | undefined,
): Promise<ShareArtwork | undefined> => {
  if (!file) return undefined;
  if (file.size > SHARE_ARTWORK_MAX_BYTES)
    throw new ShareManifestValidationError("share_artwork_too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectImageType(bytes);
  if (!type) throw new ShareManifestValidationError("share_artwork_invalid");
  return { bytes, type, sha256: await hashBytes(bytes) };
};

const hashBytes = async (bytes: Uint8Array) =>
  base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes))));

/** Validates complete encoded images, dimensions, and type without trusting MIME headers. */
const detectImageType = (bytes: Uint8Array): ShareArtwork["type"] | undefined => {
  if (bytes.length < 24) return undefined;
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52 &&
    readU32(bytes, 16) > 0 &&
    readU32(bytes, 20) > 0
  ) {
    const width = readU32(bytes, 16);
    const height = readU32(bytes, 20);
    if (!validDimensions(width, height) || !hasCompletePng(bytes)) return undefined;
    return "image/png";
  }

  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let dimensions: { width: number; height: number } | undefined;
  let sawScan = false;
  for (let index = 2; index + 1 < bytes.length; ) {
    if (bytes[index] !== 0xff) return undefined;
    while (bytes[index] === 0xff) index++;
    const marker = bytes[index++];
    if (marker === 0xd9)
      return sawScan && Boolean(dimensions) && bytes.at(-1) === 0xd9 ? "image/jpeg" : undefined;
    if (marker === 0xda) {
      sawScan = true;
      if (index + 1 >= bytes.length) return undefined;
      const length = (bytes[index] << 8) | bytes[index + 1];
      if (length < 2 || index + length > bytes.length) return undefined;
      return dimensions &&
        validDimensions(dimensions.width, dimensions.height) &&
        bytes.at(-1) === 0xd9
        ? "image/jpeg"
        : undefined;
    }
    if (index + 1 >= bytes.length) return undefined;
    const length = (bytes[index] << 8) | bytes[index + 1];
    if (length < 2 || index + length > bytes.length) return undefined;
    if (marker >= 0xc0 && marker <= 0xc3 && index + 6 < bytes.length) {
      dimensions = {
        width: (bytes[index + 5] << 8) | bytes[index + 6],
        height: (bytes[index + 3] << 8) | bytes[index + 4],
      };
    }
    index += length;
  }
  return undefined;
};

const validDimensions = (width: number, height: number) =>
  width > 0 &&
  height > 0 &&
  width <= SHARE_ARTWORK_MAX_EDGE &&
  height <= SHARE_ARTWORK_MAX_EDGE &&
  width * height <= SHARE_ARTWORK_MAX_PIXELS;

const hasCompletePng = (bytes: Uint8Array) => {
  let offset = 8;
  let sawIdat = false;
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") return sawIdat && length === 0 && end === bytes.length;
    offset = end;
  }
  return false;
};

const readU32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>>
  0;

const withArtwork = (manifest: ShareManifest, artwork: ShareArtwork | undefined): ShareManifest => {
  const { artwork: clientArtwork, ...album } = manifest.album;
  if (clientArtwork && !artwork) throw new ShareManifestValidationError("share_artwork_missing");
  return decodeManifest({
    ...manifest,
    album: {
      ...album,
      ...(artwork
        ? {
            artwork: {
              ...(clientArtwork ?? { kind: "stored", type: 3, description: "album cover" }),
              format: artwork.type,
            } satisfies ManifestArtwork,
          }
        : {}),
    },
  });
};

const withoutArtwork = (manifest: ShareManifest): ShareManifest => {
  const { artwork: _artwork, ...album } = manifest.album;
  return decodeManifest({ ...manifest, album });
};

const withRetainedArtwork = (
  manifest: ShareManifest,
  record: StoredShareManifest,
): ShareManifest => {
  if (!record.artworkKey) return withArtwork(manifest, undefined);
  const storedManifest = decodeStored(record.payloadJson);
  const descriptor = manifest.album.artwork ?? storedManifest?.album.artwork;
  if (!descriptor || !record.artworkType)
    throw new ShareManifestValidationError("share_artwork_missing");
  const { artwork: _artwork, ...album } = manifest.album;
  return decodeManifest({
    ...manifest,
    album: { ...album, artwork: { ...descriptor, format: record.artworkType } },
  });
};

const decodeStored = (payloadJson: string): ShareManifest | undefined => {
  try {
    return decodeManifest(JSON.parse(payloadJson));
  } catch {
    return undefined;
  }
};

const active = (record: StoredShareManifest | undefined, now: number) =>
  record && record.status === "active" && record.expiresAt > now ? record : undefined;

const equalSecretHashes = (left: string, right: string) => {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
};

const samePublishedValue = (left: StoredShareManifest, right: StoredShareManifest) =>
  left.payloadJson === right.payloadJson &&
  left.artworkType === right.artworkType &&
  left.artworkBytes === right.artworkBytes &&
  left.artworkSha256 === right.artworkSha256;

export const createShareManifestStore = (
  persistence: ShareManifestPersistence,
  options: { now?: () => number; randomToken?: (bytes?: number) => string } = {},
) => {
  const clock = options.now ?? nowMs;
  const token = options.randomToken ?? randomToken;
  return {
    publish: async (manifest: ShareManifest, artwork: ShareArtwork | undefined) => {
      const payload = JSON.stringify(withArtwork(manifest, artwork));
      const payloadBytes = utf8.encode(payload).byteLength;
      if (payloadBytes > SHARE_MANIFEST_MAX_BYTES)
        throw new ShareManifestValidationError("share_manifest_too_large");
      const createdAt = clock();
      const expiresAt = createdAt + SHARE_MANIFEST_LIFETIME_MS;
      const revocationToken = token();
      const revocationTokenHash = await hashShareSecret(revocationToken);

      for (let attempt = 0; attempt < 3; attempt++) {
        const slug = token(16);
        // An attempt-specific key prevents a slug collision from overwriting an existing cover.
        const artworkKey = artwork
          ? `shares/${slug}/${token(8)}.${artwork.type === "image/png" ? "png" : "jpg"}`
          : undefined;
        if (artwork && artworkKey) {
          try {
            await persistence.putArtwork({ ...artwork, key: artworkKey, expiresAt });
          } catch (error) {
            await persistence.deleteArtwork(artworkKey).catch(() => undefined);
            throw error;
          }
        }
        const created = await persistence
          .create({
            slug,
            version: manifest.version,
            payloadJson: payload,
            artworkKey,
            artworkType: artwork?.type,
            artworkBytes: artwork?.bytes.byteLength,
            artworkSha256: artwork?.sha256,
            revocationTokenHash,
            trackCount: manifest.tracks.length,
            payloadBytes,
            status: "active",
            createdAt,
            expiresAt,
          })
          .catch(async (error) => {
            if (artworkKey) await persistence.deleteArtwork(artworkKey).catch(() => undefined);
            throw error;
          });
        if (created === "created") return { slug, expiresAt, revocationToken };
        if (artworkKey) await persistence.deleteArtwork(artworkKey).catch(() => undefined);
      }
      throw new Error("share_slug_collision");
    },
    update: async (
      slug: string,
      revocationToken: string,
      manifest: ShareManifest,
      artworkUpdate: ShareArtworkUpdate,
    ): Promise<ShareManifestUpdateResult> => {
      if (!SHARE_SLUG_PATTERN.test(slug) || !revocationToken) return unavailable();
      const now = clock();
      const previous = active(await persistence.get(slug), now);
      if (!previous) return unavailable();
      const revocationTokenHash = await hashShareSecret(revocationToken);
      if (!equalSecretHashes(previous.revocationTokenHash, revocationTokenHash))
        return unavailable();

      const artwork = artworkUpdate.kind === "replace" ? artworkUpdate.artwork : undefined;
      const nextManifest =
        artworkUpdate.kind === "remove"
          ? withoutArtwork(manifest)
          : artworkUpdate.kind === "replace"
            ? withArtwork(manifest, artwork)
            : withRetainedArtwork(manifest, previous);
      const payloadJson = JSON.stringify(nextManifest);
      const payloadBytes = utf8.encode(payloadJson).byteLength;
      if (payloadBytes > SHARE_MANIFEST_MAX_BYTES)
        throw new ShareManifestValidationError("share_manifest_too_large");

      let artworkKey = artworkUpdate.kind === "retain" ? previous.artworkKey : undefined;
      if (artworkUpdate.kind === "replace") {
        const extension = artwork?.type === "image/png" ? "png" : "jpg";
        for (let attempt = 0; attempt < 3; attempt++) {
          const candidate = `shares/${slug}/${token(8)}.${extension}`;
          if (candidate !== previous.artworkKey) {
            artworkKey = candidate;
            break;
          }
        }
        if (!artworkKey) throw new Error("share_artwork_key_collision");
      }
      const replacement: StoredShareManifest = {
        ...previous,
        version: nextManifest.version,
        payloadJson,
        payloadBytes,
        trackCount: nextManifest.tracks.length,
        artworkKey,
        artworkType:
          artworkUpdate.kind === "replace"
            ? artwork?.type
            : artworkUpdate.kind === "retain"
              ? previous.artworkType
              : undefined,
        artworkBytes:
          artworkUpdate.kind === "replace"
            ? artwork?.bytes.byteLength
            : artworkUpdate.kind === "retain"
              ? previous.artworkBytes
              : undefined,
        artworkSha256:
          artworkUpdate.kind === "replace"
            ? artwork?.sha256
            : artworkUpdate.kind === "retain"
              ? previous.artworkSha256
              : undefined,
      };

      if (artwork && artworkKey) {
        try {
          await persistence.putArtwork({
            ...artwork,
            key: artworkKey,
            expiresAt: previous.expiresAt,
          });
        } catch (error) {
          // R2 may have stored the object before reporting a failure. The
          // candidate key is not referenced by D1 yet, so clean it up while
          // preserving the original failure semantics.
          await persistence.deleteArtwork(artworkKey).catch(() => undefined);
          throw error;
        }
      }
      let outcome: "updated" | "conflict";
      try {
        outcome = await persistence.update({ previous, replacement, revocationTokenHash, now });
      } catch (error) {
        if (artwork && artworkKey) {
          let current: StoredShareManifest | undefined;
          try {
            current = await persistence.get(slug);
          } catch {
            // The D1 outcome is ambiguous and verification failed. Preserve
            // the candidate rather than risking deletion of a live object.
            throw error;
          }
          if (current?.artworkKey === artworkKey) {
            if (
              equalSecretHashes(current.revocationTokenHash, revocationTokenHash) &&
              samePublishedValue(current, replacement)
            ) {
              if (previous.artworkKey && previous.artworkKey !== artworkKey)
                await persistence.deleteArtwork(previous.artworkKey).catch(() => undefined);
              return { kind: "updated", slug, expiresAt: current.expiresAt };
            }
            throw error;
          }
          await persistence.deleteArtwork(artworkKey).catch(() => undefined);
        }
        throw error;
      }
      if (outcome === "conflict") {
        // Do not delete a candidate until the live row has been checked. If
        // this read fails, the candidate remains orphaned but recoverable.
        const current = active(await persistence.get(slug), now);
        if (artwork && artworkKey && current?.artworkKey !== artworkKey)
          await persistence.deleteArtwork(artworkKey).catch(() => undefined);
        return current &&
          equalSecretHashes(current.revocationTokenHash, revocationTokenHash) &&
          samePublishedValue(current, replacement)
          ? { kind: "updated", slug, expiresAt: current.expiresAt }
          : unavailable();
      }
      if (previous.artworkKey && previous.artworkKey !== artworkKey)
        await persistence.deleteArtwork(previous.artworkKey).catch(() => undefined);
      return { kind: "updated", slug, expiresAt: previous.expiresAt };
    },
    load: async (slug: string): Promise<ShareManifestLoaded | ShareManifestUnavailable> => {
      if (!SHARE_SLUG_PATTERN.test(slug)) return unavailable();
      const record = active(await persistence.get(slug), clock());
      if (!record) return unavailable();
      const manifest = decodeStored(record.payloadJson);
      return manifest
        ? { kind: "available", manifest, expiresAt: record.expiresAt }
        : unavailable();
    },
    loadArtwork: async (slug: string) => {
      if (!SHARE_SLUG_PATTERN.test(slug)) return unavailable();
      const record = active(await persistence.get(slug), clock());
      if (!record?.artworkKey) return unavailable();
      const artwork = await persistence.getArtwork(record.artworkKey);
      if (artwork && (artwork.type !== record.artworkType || artwork.size !== record.artworkBytes))
        return unavailable();
      return artwork
        ? {
            kind: "available" as const,
            artwork: { ...artwork, sha256: record.artworkSha256 ?? artwork.sha256 },
          }
        : unavailable();
    },
    revoke: async (slug: string, token: string): Promise<ShareManifestRevokeResult> => {
      if (!SHARE_SLUG_PATTERN.test(slug) || !token) return "unavailable";
      const record = await persistence.disable(slug, await hashShareSecret(token), clock());
      if (!record) return "unavailable";
      if (!record.artworkKey) return "revoked";
      try {
        await persistence.deleteArtwork(record.artworkKey);
        return "revoked";
      } catch {
        return "artwork_unavailable";
      }
    },
  };
};
