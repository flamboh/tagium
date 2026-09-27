-- Rebuilds share_manifests so indefinite shares can store a null expires_at. Existing rows are
-- copied unchanged. Run it once; scripts/apply-share-migrations.ts skips it after expires_at is
-- nullable.
CREATE TABLE share_manifests_next (
  slug TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  artwork_key TEXT,
  artwork_type TEXT,
  artwork_bytes INTEGER,
  artwork_sha256 TEXT,
  revocation_token_hash TEXT NOT NULL,
  track_count INTEGER NOT NULL,
  payload_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

INSERT INTO share_manifests_next (
  slug, version, payload_json, artwork_key, artwork_type, artwork_bytes, artwork_sha256,
  revocation_token_hash, track_count, payload_bytes, status, created_at, expires_at
)
SELECT
  slug, version, payload_json, artwork_key, artwork_type, artwork_bytes, artwork_sha256,
  revocation_token_hash, track_count, payload_bytes, status, created_at, expires_at
FROM share_manifests;

DROP TABLE share_manifests;

ALTER TABLE share_manifests_next RENAME TO share_manifests;

CREATE INDEX share_manifests_expires_at
  ON share_manifests(expires_at)
  WHERE expires_at IS NOT NULL;
