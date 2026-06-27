import { FileTree } from "@pierre/trees/react";
import type { ContextMenuItem } from "@pierre/trees";
import type { ComponentProps } from "react";
import { buildLibraryTree } from "./libraryTree";
import { AlbumGroup, TagiumFile } from "./types";

const isRetryableError = (track: TagiumFile) =>
  Boolean(track.downloadRequest) && (track.downloadStatus === "error" || track.status === "error");

const canDownloadAlbum = (album: AlbumGroup, filesById: Map<string, TagiumFile>) =>
  album.trackIds.length > 0 &&
  album.trackIds.every((trackId) => {
    const file = filesById.get(trackId);
    return file?.file && file.metadata;
  });

export function LibraryTreeContextMenu({
  albumsById,
  context,
  filesById,
  item,
  onDownloadAlbum,
  onEditAlbum,
  onRemoveFile,
  onRetryDownload,
  tree,
}: {
  albumsById: Map<string, AlbumGroup>;
  context: Parameters<NonNullable<ComponentProps<typeof FileTree>["renderContextMenu"]>>[1];
  filesById: Map<string, TagiumFile>;
  item: ContextMenuItem;
  onDownloadAlbum: (albumId: string) => void;
  onEditAlbum: (albumId: string) => void;
  onRemoveFile: (fileId: string) => void;
  onRetryDownload: (fileId: string) => void;
  tree: ReturnType<typeof buildLibraryTree>;
}) {
  const entry = tree.entriesByPath.get(item.path);
  if (!entry) return null;

  const runAction = (action: () => void) => {
    context.close({ restoreFocus: false });
    action();
  };

  if (entry.type === "album") {
    const album = albumsById.get(entry.albumId);
    if (!album) return null;

    return (
      <div className="min-w-44 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md">
        <button
          type="button"
          className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
          onClick={() => runAction(() => onEditAlbum(entry.albumId))}
        >
          edit album
        </button>
        <button
          type="button"
          className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canDownloadAlbum(album, filesById)}
          onClick={() => runAction(() => onDownloadAlbum(entry.albumId))}
        >
          download album
        </button>
      </div>
    );
  }

  if (entry.type === "track") {
    const track = filesById.get(entry.trackId);
    if (!track) return null;

    return (
      <div className="min-w-44 rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md">
        {isRetryableError(track) && (
          <button
            type="button"
            className="w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent"
            onClick={() => runAction(() => onRetryDownload(entry.trackId))}
          >
            retry download
          </button>
        )}
        <button
          type="button"
          className="w-full rounded-sm px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
          onClick={() => runAction(() => onRemoveFile(entry.trackId))}
        >
          remove track
        </button>
      </div>
    );
  }

  return null;
}
