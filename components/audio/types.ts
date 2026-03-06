export interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string | string[];
  year?: number;
  trackNumber?: number;
  picture?: Array<{
    format: string;
    type: number;
    data: Uint8Array;
    description?: string;
  }>;
  duration: number;
  bitrate: number;
  sampleRate: number;
}

export interface AlbumGroup {
  id: string;
  title: string;
  artist: string;
  genre: string;
  cover?: AudioMetadata["picture"];
  trackIds: string[];
  syncTrackNumbers: boolean;
}

export interface TagiumFile {
  id: string;
  file: File;
  filename: string;
  metadata?: AudioMetadata;
  status: "pending" | "saved" | "error";
}
