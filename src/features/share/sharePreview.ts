import type { AudioMetadata } from "@/features/audio/metadata";
import type { AlbumGroup, TagiumFile } from "@/features/library/types";

export interface SharePreviewTrack {
  /** Stable within this snapshot, including when an album contains the same id twice. */
  key: string;
  title: string;
}

export interface SharePreviewCover {
  format: string;
  /** Immutable display artwork retained by the dialog. */
  blob: Blob;
}

export interface ShareAlbumPreview {
  albumTitle: string;
  tracks: readonly SharePreviewTrack[];
  cover: SharePreviewCover | null;
}

type Picture = AudioMetadata["picture"][number];

/** Build the small, display-only snapshot retained by the sharing dialog. */
export const buildShareAlbumPreview = (
  album: Pick<AlbumGroup, "title" | "trackIds" | "cover">,
  files: readonly (Pick<TagiumFile, "id" | "filename" | "metadata"> | undefined)[],
): ShareAlbumPreview => {
  const occurrences = new Map<string, number>();
  const tracks = album.trackIds.map((trackId, index) => {
    const occurrence = occurrences.get(trackId) ?? 0;
    occurrences.set(trackId, occurrence + 1);
    const file = files[index];
    const title = file?.metadata?.title?.trim() || file?.filename || "untitled track";
    return { key: `${trackId}:${occurrence}`, title };
  });

  const first = album.cover?.[0] as Picture | undefined;
  const cover = first?.data?.byteLength
    ? {
        format: first.format,
        // Materialize one exact, immutable backing buffer for the preview.
        blob: new Blob(
          [
            first.data.buffer.slice(
              first.data.byteOffset,
              first.data.byteOffset + first.data.byteLength,
            ),
          ],
          { type: first.format },
        ),
      }
    : null;

  return { albumTitle: album.title, tracks, cover };
};
