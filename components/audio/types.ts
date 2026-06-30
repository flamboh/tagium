import { z } from "zod";
import type { AudioDownloadBitrate } from "./cobaltDownload";

export const audioMetadataSchema = z.object({
  filename: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  year: z.number().nullish(),
  genre: z.string().or(z.array(z.string())),
  duration: z.number(),
  bitrate: z.number(),
  sampleRate: z.number(),
  picture: z.array(
    z.object({
      format: z.string(),
      type: z.number(),
      description: z.string(),
      data: z.instanceof(Uint8Array),
    }),
  ),
  trackNumber: z.number().nullish(),
});

export type AudioMetadata = z.infer<typeof audioMetadataSchema>;

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
  hasBufferedChanges: boolean;
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
}

export interface ImportedAlbumMetadata {
  title: string;
  artist: string;
  genre: string;
  year?: number;
  coverUrl?: string;
}
