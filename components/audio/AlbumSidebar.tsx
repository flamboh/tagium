"use client";

import { prepareFileTreeInput } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type {
  FileTreeDropResult,
  FileTreeRowDecorationContext,
  FileTreeSortComparator,
} from "@pierre/trees";
import { Plus } from "lucide-react";
import { useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LibraryTreeContextMenu } from "./LibraryTreeContextMenu";
import { buildLibraryTree } from "./libraryTree";
import {
  getLibraryTreeModelDropPlacement,
  getLibraryTreeModelDropTargetEntry,
  handleLibraryTreeDrop,
  handleLibraryTreeModelDrop,
} from "./libraryTreeDrop";
import { getNativeTreePath, isTreeOwnedClick, resolveSelection } from "./libraryTreeSelection";
import type { LibraryTreeSelection } from "./libraryTreeSelection";
import { LIBRARY_TREE_CSS, LIBRARY_TREE_STYLE } from "./libraryTreeStyles";
import { AlbumGroup, TagiumFile } from "./types";

export type { LibraryTreeSelection } from "./libraryTreeSelection";

interface AlbumSidebarProps {
  albums: AlbumGroup[];
  looseTrackIds: string[];
  files: TagiumFile[];
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
  externalSelectionRevision: number;
  onTreeSelectionChange: (selection: LibraryTreeSelection) => void;
  onClearSelection: () => void;
  onRemoveFile: (fileId: string) => void;
  onRetryDownload: (fileId: string) => void;
  onAddAlbum: () => void;
  onEditAlbum: (albumId: string) => void;
  onDownloadAlbum: (albumId: string) => void;
  onUploadToAlbum: (albumId: string, files: File[]) => void;
  onMoveTrackToAlbum: (
    trackId: string,
    targetAlbumId: string,
    placement: "before" | "after" | "append",
    referenceTrackId?: string,
  ) => void;
  onMoveTrackToLoose: (
    trackId: string,
    placement: "before" | "after" | "append",
    referenceTrackId?: string,
  ) => void;
  onPromptCreateAlbumFromLooseTracks: (sourceTrackId: string, targetTrackId: string) => void;
  onReorderAlbums: (albumId: string, targetIndex: number) => void;
  onAudioUpload: (files: File[]) => void;
}

interface LibraryFileTreeProps extends AlbumSidebarProps {
  tree: ReturnType<typeof buildLibraryTree>;
}

function LibraryFileTree(props: LibraryFileTreeProps) {
  const {
    albums,
    files,
    onAudioUpload,
    onMoveTrackToAlbum,
    onMoveTrackToLoose,
    onPromptCreateAlbumFromLooseTracks,
    onReorderAlbums,
    onTreeSelectionChange,
    onUploadToAlbum,
    selectedAlbumId,
    selectedFileId,
    selectedFileIds,
    tree,
  } = props;
  const filesById = useMemo(() => new Map(files.map((file) => [file.id, file])), [files]);
  const albumsById = useMemo(() => new Map(albums.map((album) => [album.id, album])), [albums]);
  const treePointerHandlerRef = useRef<(event: PointerEvent) => void>(() => undefined);
  const treePointerCleanupRef = useRef<(() => void) | null>(null);
  const treeElementRef = useRef<HTMLDivElement | null>(null);
  const treePointerYRef = useRef<number | null>(null);
  const liveTreeStateRef = useRef({
    albums,
    filesById,
    onMoveTrackToAlbum,
    onMoveTrackToLoose,
    onReorderAlbums,
    onTreeSelectionChange,
    tree,
  });
  liveTreeStateRef.current = {
    albums,
    filesById,
    onMoveTrackToAlbum,
    onMoveTrackToLoose,
    onReorderAlbums,
    onTreeSelectionChange,
    tree,
  };
  treePointerHandlerRef.current = (event) => {
    treePointerYRef.current = event.clientY;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const path = getNativeTreePath(event);
    if (!path) return;
    const live = liveTreeStateRef.current;
    const entry = live.tree.entriesByPath.get(path);
    if (entry?.type === "track" && selectedFileIds.has(entry.trackId)) return;
    live.onTreeSelectionChange(resolveSelection([path], live.tree.entriesByPath));
  };
  const treeWrapperRef = useMemo(
    () => (node: HTMLDivElement | null) => {
      treePointerCleanupRef.current?.();
      treePointerCleanupRef.current = null;
      treeElementRef.current = node;
      if (!node) return;

      const handlePointerDown = (event: PointerEvent) => {
        treePointerHandlerRef.current(event);
      };
      const handlePointerMove = (event: PointerEvent) => {
        treePointerYRef.current = event.clientY;
      };
      node.addEventListener("pointerdown", handlePointerDown, { capture: true });
      node.addEventListener("pointermove", handlePointerMove, { capture: true });
      treePointerCleanupRef.current = () => {
        node.removeEventListener("pointerdown", handlePointerDown, { capture: true });
        node.removeEventListener("pointermove", handlePointerMove, { capture: true });
      };
    },
    [],
  );
  const selectedPaths = useMemo(
    () =>
      tree.paths.filter((path) => {
        const entry = tree.entriesByPath.get(path);
        return entry?.type === "track" && selectedFileIds.has(entry.trackId);
      }),
    [selectedFileIds, tree.entriesByPath, tree.paths],
  );
  const preparedInput = useMemo(() => {
    const orderByPath = new Map(tree.paths.map((path, index) => [path, index]));
    const sort: FileTreeSortComparator = (left, right) =>
      (orderByPath.get(left.path) ?? 0) - (orderByPath.get(right.path) ?? 0);
    return prepareFileTreeInput(tree.paths, { sort });
  }, [tree.paths]);
  const initialSelectedPaths =
    selectedPaths.length > 0
      ? selectedPaths
      : selectedFileId
        ? [tree.pathByTrackId.get(selectedFileId)].filter((path): path is string => Boolean(path))
        : selectedAlbumId
          ? [tree.pathByAlbumId.get(selectedAlbumId)].filter((path): path is string =>
              Boolean(path),
            )
          : [];
  const { model } = useFileTree({
    composition: {
      contextMenu: {
        buttonVisibility: "when-needed",
        enabled: true,
        triggerMode: "both",
      },
    },
    dragAndDrop: {
      canDrag: (paths) =>
        paths.every((path) => Boolean(liveTreeStateRef.current.tree.entriesByPath.get(path))),
      canDrop: (event) => {
        const [draggedPath] = event.draggedPaths;
        const draggedEntry = draggedPath
          ? liveTreeStateRef.current.tree.entriesByPath.get(draggedPath)
          : null;
        if (!draggedEntry) return false;
        if (draggedEntry.type === "album") {
          const targetEntry = getLibraryTreeModelDropTargetEntry(
            event,
            liveTreeStateRef.current.tree,
          );
          return targetEntry?.type === "album";
        }
        return true;
      },
      onDropComplete: (event: FileTreeDropResult) => {
        handleLibraryTreeModelDrop({
          albums,
          event,
          handlers: {
            onAudioUpload,
            onMoveTrackToAlbum,
            onMoveTrackToLoose,
            onPromptCreateAlbumFromLooseTracks,
            onReorderAlbums,
            onSelectTracks: onTreeSelectionChange,
            onUploadToAlbum,
          },
          placement: getLibraryTreeModelDropPlacement({
            event,
            pointerY: treePointerYRef.current,
            treeElement: treeElementRef.current,
          }),
          tree,
        });
      },
    },
    flattenEmptyDirectories: false,
    icons: "minimal",
    initialExpansion: "open",
    initialSelectedPaths,
    itemHeight: 34,
    onSelectionChange: (paths) => {
      const live = liveTreeStateRef.current;
      live.onTreeSelectionChange(resolveSelection(paths, live.tree.entriesByPath));
    },
    preparedInput,
    renderRowDecoration: ({ item }: FileTreeRowDecorationContext) => {
      const live = liveTreeStateRef.current;
      const entry = live.tree.entriesByPath.get(item.path);
      if (entry?.type !== "track") return null;
      const track = live.filesById.get(entry.trackId);
      if (!track) return null;
      if (track.downloadStatus === "downloading") return { text: "...", title: "downloading" };
      if (track.downloadStatus === "error" || track.status === "error") {
        return {
          text: "!",
          title: track.downloadError ? `error: ${track.downloadError}` : "error",
        };
      }
      if (track.status === "saved") return { text: "ok", title: "saved" };
      return null;
    },
    unsafeCSS: LIBRARY_TREE_CSS,
  });

  return (
    <div ref={treeWrapperRef} className="min-h-0 flex-1 flex flex-col">
      <FileTree
        model={model}
        className="min-h-0 flex-1"
        style={LIBRARY_TREE_STYLE}
        onClick={(event) => {
          if (!isTreeOwnedClick(event.nativeEvent)) {
            props.onClearSelection();
          }
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDropCapture={(event) => {
          handleLibraryTreeDrop({
            albums,
            event,
            handlers: {
              onAudioUpload,
              onMoveTrackToAlbum,
              onMoveTrackToLoose,
              onPromptCreateAlbumFromLooseTracks,
              onReorderAlbums,
              onSelectTracks: onTreeSelectionChange,
              onUploadToAlbum,
            },
            selectedPaths,
            tree,
          });
        }}
        renderContextMenu={(item, context) => (
          <LibraryTreeContextMenu
            albumsById={albumsById}
            context={context}
            filesById={filesById}
            item={item}
            onDownloadAlbum={props.onDownloadAlbum}
            onEditAlbum={props.onEditAlbum}
            onRemoveFile={props.onRemoveFile}
            onRetryDownload={props.onRetryDownload}
            tree={tree}
          />
        )}
      />
    </div>
  );
}

export default function AlbumSidebar(props: AlbumSidebarProps) {
  const tree = useMemo(
    () =>
      buildLibraryTree({
        albums: props.albums,
        files: props.files,
        looseTrackIds: props.looseTrackIds,
      }),
    [props.albums, props.files, props.looseTrackIds],
  );

  if (props.albums.length === 0 && props.looseTrackIds.length === 0) {
    return (
      <div
        className="w-full flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground px-4"
        onClick={props.onClearSelection}
      >
        <p>no tracks yet</p>
        <p className="text-xs">create an empty album or upload tracks</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            props.onAddAlbum();
          }}
        >
          <Plus className="h-4 w-4" />
          add album
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col">
      <div className="h-12 px-4 border-b flex items-center justify-between flex-shrink-0">
        <span className="font-semibold text-sm leading-none text-muted-foreground">
          library ({props.files.length})
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-8")}
          onClick={props.onAddAlbum}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      <LibraryFileTree
        key={`${tree.signature}\n${props.externalSelectionRevision}`}
        {...props}
        tree={tree}
      />
    </div>
  );
}
