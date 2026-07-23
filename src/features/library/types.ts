import type { AudioDownloadBitrate } from "@/features/import/cobaltAudio";
import type { AudioMetadata, MetadataPatch } from "@/features/audio/metadata";

export type { AudioMetadata, MetadataPatch } from "@/features/audio/metadata";

export interface TagiumFile {
  id: string;
  file?: File;
  originalFile?: File;
  sourceImportKey?: string;
  status: "pending" | "saved" | "error";
  downloadStatus: "downloading" | "ready" | "error" | "canceled";
  downloadError?: string;
  downloadRequest?: {
    sourceUrl: string;
    audioBitrate: AudioDownloadBitrate;
    year?: number;
  };
  pendingMetadataPatch?: MetadataPatch;
  // Compatibility for UI/status consumers that still render a buffered flag.
  // Lazy metadata writes must derive from pendingMetadataPatch instead.
  hasBufferedChanges?: boolean;
  filename: string;
  metadata?: AudioMetadata;
}

export interface AlbumGroup {
  id: string;
  title: string;
  artist: string;
  genre: string;
  cover?: AudioMetadata["picture"];
  trackIds: string[];
  year?: number;
  /** Original provider playlist/set URL, when available. */
  sourceUrl?: string;
  /** In-memory provenance used to prevent accidental duplicate share-link imports. */
  sourceManifestSlug?: string;
  /** The single creator-owned publication associated with this in-memory album. */
  sharePublication?: {
    slug: string;
    url: string;
    expiresAt: string;
    publishedFingerprint: string;
    status: "active" | "stopped";
  };
}

export interface AppSettings {
  syncTrackNumbers: boolean;
  syncFilenames: boolean;
  audioBitrate: AudioDownloadBitrate;
  applySoundCloudAlbumCoverToTracks: boolean;
}

export interface ImportedAlbumMetadata {
  title: string;
  artist: string;
  genre: string;
  year?: number;
  coverUrl?: string;
}
