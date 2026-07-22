import type { ShareManifestPersistence, StoredShareManifest } from "./share-manifest";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<{ meta: { changes?: number } }>;
};
export type D1DatabaseBinding = { prepare: (query: string) => D1Statement };
export type R2BucketBinding = {
  put: (
    key: string,
    value: Uint8Array,
    options: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> },
  ) => Promise<unknown>;
  get: (key: string) => Promise<{
    body: ReadableStream<Uint8Array>;
    httpMetadata?: { contentType?: string };
    size: number;
    etag: string;
    checksums?: { sha256?: ArrayBuffer };
  } | null>;
  delete: (key: string) => Promise<void>;
};

type D1Row = Omit<
  StoredShareManifest,
  "artworkKey" | "artworkType" | "artworkBytes" | "artworkSha256"
> & {
  artworkKey: string | null;
  artworkType: string | null;
  artworkBytes: number | null;
  artworkSha256: string | null;
};

const fromRow = (row: D1Row): StoredShareManifest => ({
  ...row,
  artworkKey: row.artworkKey ?? undefined,
  artworkType: row.artworkType ?? undefined,
  artworkBytes: row.artworkBytes ?? undefined,
  artworkSha256: row.artworkSha256 ?? undefined,
});

export const createCloudflareShareManifestPersistence = ({
  database,
  artwork,
}: {
  database: D1DatabaseBinding;
  artwork: R2BucketBinding;
}): ShareManifestPersistence => ({
  putArtwork: async ({ key, bytes, type, sha256, expiresAt }) => {
    await artwork.put(key, bytes, {
      httpMetadata: { contentType: type },
      customMetadata: { sha256, expiresAt: String(expiresAt) },
    });
  },
  deleteArtwork: (key) => artwork.delete(key),
  getArtwork: async (key) => {
    const object = await artwork.get(key);
    if (!object) return undefined;
    return {
      body: object.body,
      type: object.httpMetadata?.contentType ?? "application/octet-stream",
      size: object.size,
      sha256: object.etag,
    };
  },
  create: async (record) => {
    try {
      await database
        .prepare(
          `INSERT INTO share_manifests (
          slug, version, payload_json, artwork_key, artwork_type, artwork_bytes, artwork_sha256,
          revocation_token_hash, track_count, payload_bytes, status, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.slug,
          record.version,
          record.payloadJson,
          record.artworkKey ?? null,
          record.artworkType ?? null,
          record.artworkBytes ?? null,
          record.artworkSha256 ?? null,
          record.revocationTokenHash,
          record.trackCount,
          record.payloadBytes,
          record.status,
          record.createdAt,
          record.expiresAt,
        )
        .run();
      return "created";
    } catch (error) {
      if (error instanceof Error && /unique|constraint/i.test(error.message)) return "conflict";
      throw error;
    }
  },
  get: async (slug) => {
    const row = await database
      .prepare(
        `SELECT slug, version, payload_json AS payloadJson, artwork_key AS artworkKey, artwork_type AS artworkType,
        artwork_bytes AS artworkBytes, artwork_sha256 AS artworkSha256, revocation_token_hash AS revocationTokenHash,
        track_count AS trackCount, payload_bytes AS payloadBytes, status, created_at AS createdAt, expires_at AS expiresAt
       FROM share_manifests WHERE slug = ?`,
      )
      .bind(slug)
      .first<D1Row>();
    return row ? fromRow(row) : undefined;
  },
  disable: async (slug, tokenHash, now) => {
    const row = await database
      .prepare(
        `UPDATE share_manifests SET status = 'disabled'
       WHERE slug = ? AND revocation_token_hash = ? AND expires_at > ?
       RETURNING slug, version, payload_json AS payloadJson, artwork_key AS artworkKey, artwork_type AS artworkType,
         artwork_bytes AS artworkBytes, artwork_sha256 AS artworkSha256, revocation_token_hash AS revocationTokenHash,
         track_count AS trackCount, payload_bytes AS payloadBytes, status, created_at AS createdAt, expires_at AS expiresAt`,
      )
      .bind(slug, tokenHash, now)
      .first<D1Row>();
    return row ? fromRow(row) : undefined;
  },
});
