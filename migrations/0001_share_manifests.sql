-- Safe to re-run before each deploy; this migration only adds the share-manifest schema.
CREATE TABLE IF NOT EXISTS share_manifests (
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
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS share_manifests_expires_at
  ON share_manifests(expires_at)
  WHERE expires_at IS NOT NULL;
