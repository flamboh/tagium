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

export interface SharePreview {
  kind: "album" | "track";
  title: string;
  tracks: readonly SharePreviewTrack[];
  cover: SharePreviewCover | null;
}

/** Build the small, display-only snapshot retained by the sharing dialog. */
export const buildShareAlbumPreview = (
  album: Pick<AlbumGroup, "title" | "trackIds" | "cover">,
  files: readonly (Pick<TagiumFile, "id" | "filename" | "metadata"> | undefined)[],
): SharePreview => {
  const occurrences = new Map<string, number>();
  const tracks = album.trackIds.map((trackId, index) => {
    const occurrence = occurrences.get(trackId) ?? 0;
    occurrences.set(trackId, occurrence + 1);
    const file = files[index];
    const title = file?.metadata?.title?.trim() || file?.filename || "untitled track";
    return { key: `${trackId}:${occurrence}`, title };
  });

  const first = album.cover?.[0];
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

  return { kind: "album", title: album.title, tracks, cover };
};

/** Build an immutable preview from a track's effective buffered metadata. */
export const buildShareTrackPreview = (
  file: Pick<TagiumFile, "id" | "filename" | "metadata" | "pendingMetadataPatch">,
): SharePreview => {
  const metadata = file.metadata ? { ...file.metadata, ...file.pendingMetadataPatch } : undefined;
  const title = metadata?.title?.trim() || metadata?.filename?.trim() || file.filename;
  const first = metadata?.picture?.[0];
  const cover = first?.data?.byteLength
    ? {
        format: first.format,
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

  return {
    kind: "track",
    title: title || "untitled track",
    tracks: [{ key: `${file.id}:0`, title: title || "untitled track" }],
    cover,
  };
};
