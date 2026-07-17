import type { AudioDownloadBitrate } from "./cobaltAudio";
import type { AudioMetadata, MetadataPatch } from "./metadata";

export type { AudioMetadata, MetadataPatch } from "./metadata";

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
}

export interface AppSettings {
  mode: "light" | "dark";
  accentA: string;
  accentB: string;
  wordmarkFont: "archivo-black" | "krona-one" | "anton" | "rajdhani";
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
