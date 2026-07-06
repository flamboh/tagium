import type { AudioDownloadBitrate } from "./cobaltDownload";
import type { AudioMetadata, MetadataPatch } from "./metadata";

export {
  audioMetadataSchema,
  metadataPatchSchema,
  metadataPictureSchema,
  metadataSnapshotSchema,
} from "./metadata";
export type { AudioMetadata, MetadataPatch, MetadataPicture, MetadataSnapshot } from "./metadata";

export interface TagiumFile {
  id: string;
  file?: File;
  originalFile?: File;
  status: "pending" | "saved" | "error";
  downloadStatus: "downloading" | "ready" | "error" | "canceled";
  downloadError?: string;
  downloadRequest?: {
    sourceUrl: string;
    audioBitrate: AudioDownloadBitrate;
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
