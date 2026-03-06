"use client";

import type { ChangeEvent, DragEvent, MouseEvent as ReactMouseEvent } from "react";
import { useRef, useState } from "react";
import { AlertCircle, Check, FileMusic, Folder, Pencil, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { AlbumGroup, TagiumFile } from "./types";

const TRACK_DRAG_TYPE = "application/x-tagium-track";
const ALBUM_DRAG_TYPE = "application/x-tagium-album";

interface AlbumSidebarProps {
  albums: AlbumGroup[];
  looseTrackIds: string[];
  files: TagiumFile[];
  selectedAlbumId: string | null;
  selectedFileId: string | null;
  selectedFileIds: Set<string>;
  onSelectAlbum: (albumId: string, event?: ReactMouseEvent) => void;
  onSelectFile: (albumId: string, fileId: string, event?: ReactMouseEvent) => void;
  onSelectLooseTrack: (fileId: string, event?: ReactMouseEvent) => void;
  onClearSelection: () => void;
  onRemoveFile: (fileId: string) => void;
  onRemoveAlbum: (albumId: string) => void;
  onAddAlbum: () => void;
  onEditAlbum: (albumId: string) => void;
  onUploadToAlbum: (albumId: string, files: File[]) => void;
  onMoveTrackToAlbum: (
    trackId: string,
    targetAlbumId: string,
    placement: "before" | "after" | "append",
    referenceTrackId?: string
  ) => void;
  onMoveTrackToLoose: (
    trackId: string,
    placement: "before" | "after" | "append",
    referenceTrackId?: string
  ) => void;
  onPromptCreateAlbumFromLooseTracks: (
    sourceTrackId: string,
    targetTrackId: string
  ) => void;
  onReorderAlbums: (albumId: string, targetIndex: number) => void;
  onAudioUpload: (files: File[]) => void;
}

interface DragPayload {
  trackId: string;
  container: "album" | "loose";
  albumId?: string;
}

interface AlbumDragPayload {
  albumId: string;
}

function parseDragPayload(event: DragEvent) {
  const rawPayload = event.dataTransfer.getData(TRACK_DRAG_TYPE);
  if (!rawPayload) return null;

  try {
    return JSON.parse(rawPayload) as DragPayload;
  } catch {
    return null;
  }
}

function parseAlbumDragPayload(event: DragEvent) {
  const rawPayload = event.dataTransfer.getData(ALBUM_DRAG_TYPE);
  if (!rawPayload) return null;

  try {
    return JSON.parse(rawPayload) as AlbumDragPayload;
  } catch {
    return null;
  }
}

function isCenteredDrop(event: DragEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const position = (event.clientY - rect.top) / rect.height;
  return position > 0.3 && position < 0.7;
}

function placementForRowDrop(event: DragEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
}

export default function AlbumSidebar({
  albums,
  looseTrackIds,
  files,
  selectedAlbumId,
  selectedFileId,
  selectedFileIds,
  onSelectAlbum,
  onSelectFile,
  onSelectLooseTrack,
  onClearSelection,
  onRemoveFile,
  onRemoveAlbum,
  onAddAlbum,
  onEditAlbum,
  onUploadToAlbum,
  onMoveTrackToAlbum,
  onMoveTrackToLoose,
  onPromptCreateAlbumFromLooseTracks,
  onReorderAlbums,
  onAudioUpload,
}: AlbumSidebarProps) {
  const albumUploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetAlbumId, setUploadTargetAlbumId] = useState<string | null>(null);
  const [draggedAlbumId, setDraggedAlbumId] = useState<string | null>(null);
  const [dragOverAlbumIndex, setDragOverAlbumIndex] = useState<number | null>(null);
  const filesById = new Map(files.map((file) => [file.id, file]));
  const looseTracks = looseTrackIds
    .map((trackId) => filesById.get(trackId))
    .filter((track): track is TagiumFile => Boolean(track));

  const triggerAlbumUpload = (albumId: string) => {
    setUploadTargetAlbumId(albumId);
    albumUploadInputRef.current?.click();
  };

  const handleAlbumUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = Array.from(event.target.files || []);
    if (uploadedFiles.length > 0 && uploadTargetAlbumId) {
      onUploadToAlbum(uploadTargetAlbumId, uploadedFiles);
    }
    event.currentTarget.value = "";
    setUploadTargetAlbumId(null);
  };

  if (albums.length === 0 && looseTracks.length === 0) {
    return (
      <div className="w-full flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground px-4">
        <p>no tracks yet</p>
        <p className="text-xs">create an empty album or upload tracks</p>
        <Button type="button" variant="outline" size="sm" onClick={onAddAlbum}>
          <Plus className="h-4 w-4" />
          add album
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col">
      <Input
        type="file"
        className="hidden"
        accept="audio/*"
        multiple
        ref={albumUploadInputRef}
        onChange={handleAlbumUpload}
      />
      <div className="pb-2 pl-6 border-b flex items-center justify-between pr-3">
        <span className="font-semibold text-sm text-muted-foreground">
          library ({files.length})
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onAddAlbum}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div
        className="flex-1 overflow-y-auto p-2 flex flex-col gap-2"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            onClearSelection();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          
          // Handle external file drops
          const files = Array.from(event.dataTransfer.files);
          if (files.length > 0) {
            const audioFiles = files.filter((file) => file.type.startsWith("audio/"));
            if (audioFiles.length > 0) {
              onAudioUpload(audioFiles);
              return;
            }
          }
          
          // Handle track drag
          const trackPayload = parseDragPayload(event);
          if (trackPayload) {
            onMoveTrackToLoose(trackPayload.trackId, "append");
            return;
          }
        }}
      >
        {looseTracks.map((track, index) => (
          <div
            key={track.id}
            className="relative group"
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const payload = parseDragPayload(event);
              if (payload && payload.trackId !== track.id) {
                event.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const payload = parseDragPayload(event);
              if (!payload || payload.trackId === track.id) return;

              if (payload.container === "loose" && isCenteredDrop(event)) {
                onPromptCreateAlbumFromLooseTracks(payload.trackId, track.id);
                return;
              }
              const placement = placementForRowDrop(event);
              onMoveTrackToLoose(payload.trackId, placement, track.id);
            }}
          >
            <Button
              type="button"
              variant="ghost"
              draggable
              onDragStart={(event) => {
                const payload: DragPayload = {
                  trackId: track.id,
                  container: "loose",
                };
                event.dataTransfer.setData(TRACK_DRAG_TYPE, JSON.stringify(payload));
                event.dataTransfer.effectAllowed = "move";
              }}
              className={cn(
                "justify-start h-auto py-2 px-2.5 w-full text-left font-normal pr-8 rounded-lg border bg-card/70",
                selectedFileIds.has(track.id)
                  ? "bg-accent text-accent-foreground border-primary/40"
                  : selectedFileId === track.id
                    ? "bg-accent/50 text-accent-foreground"
                    : ""
              )}
              onClick={(e) => onSelectLooseTrack(track.id, e)}
            >
              <div className="flex items-center gap-2 w-full overflow-hidden">
                <span className="w-5 text-[11px] text-muted-foreground">{index + 1}</span>
                <FileMusic className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="truncate text-sm flex-1">{track.filename}</span>
                {track.status === "saved" && (
                  <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
                )}
                {track.status === "error" && (
                  <AlertCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                )}
              </div>
            </Button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemoveFile(track.id);
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/10 rounded-full cursor-pointer"
              title="Remove track"
            >
              <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
            </button>
          </div>
        ))}

        {albums.map((album, albumIndex) => (
          <div
            key={album.id}
            className={cn(
              "rounded-lg border bg-card/70 transition-all",
              selectedAlbumId === album.id ? "border-primary/40 shadow-sm" : "",
              draggedAlbumId === album.id ? "opacity-50" : "",
              dragOverAlbumIndex === albumIndex ? "ring-2 ring-primary" : ""
            )}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              
              const albumPayload = parseAlbumDragPayload(event);
              if (albumPayload && albumPayload.albumId !== album.id) {
                event.dataTransfer.dropEffect = "move";
                const rect = event.currentTarget.getBoundingClientRect();
                const position = (event.clientY - rect.top) / rect.height;
                setDragOverAlbumIndex(position < 0.5 ? albumIndex : albumIndex + 1);
              } else {
                setDragOverAlbumIndex(null);
              }
              
              const trackPayload = parseDragPayload(event);
              if (trackPayload) {
                event.dataTransfer.dropEffect = "move";
              }
              
              // Handle external file drops
              if (event.dataTransfer.types.includes("Files")) {
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDragLeave={() => {
              setDragOverAlbumIndex(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              
              // Handle external file drops
              const files = Array.from(event.dataTransfer.files);
              if (files.length > 0) {
                const audioFiles = files.filter((file) => file.type.startsWith("audio/"));
                if (audioFiles.length > 0) {
                  onUploadToAlbum(album.id, audioFiles);
                  return;
                }
              }
              
              // Handle album reordering
              const albumPayload = parseAlbumDragPayload(event);
              if (albumPayload && albumPayload.albumId !== album.id) {
                const sourceIndex = albums.findIndex((a) => a.id === albumPayload.albumId);
                if (sourceIndex >= 0) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const position = (event.clientY - rect.top) / rect.height;
                  let targetIndex = position < 0.5 ? albumIndex : albumIndex + 1;
                  // Adjust target index if dragging from before the target
                  if (sourceIndex < targetIndex) {
                    targetIndex -= 1;
                  }
                  onReorderAlbums(albumPayload.albumId, targetIndex);
                }
                setDraggedAlbumId(null);
                setDragOverAlbumIndex(null);
                return;
              }
              
              // Handle track drag
              const trackPayload = parseDragPayload(event);
              if (trackPayload) {
                onMoveTrackToAlbum(trackPayload.trackId, album.id, "append");
                return;
              }
            }}
          >
            <div className="w-full flex items-center justify-between gap-1 px-2 py-1 border-b">
              <button
                type="button"
                className="min-w-0 flex-1 flex items-center gap-2 px-1 py-1 text-left hover:bg-accent/30 rounded cursor-pointer"
                onClick={(e) => onSelectAlbum(album.id, e)}
                draggable
                onDragStart={(event) => {
                  const payload: AlbumDragPayload = {
                    albumId: album.id,
                  };
                  event.dataTransfer.setData(ALBUM_DRAG_TYPE, JSON.stringify(payload));
                  event.dataTransfer.effectAllowed = "move";
                  setDraggedAlbumId(album.id);
                }}
                onDragEnd={() => {
                  setDraggedAlbumId(null);
                  setDragOverAlbumIndex(null);
                }}
              >
                <Folder className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium truncate">{album.title}</span>
              </button>
              <span className="text-xs text-muted-foreground">{album.trackIds.length}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => triggerAlbumUpload(album.id)}
                aria-label={`Upload tracks to ${album.title}`}
              >
                <Upload className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onEditAlbum(album.id)}
                aria-label={`Edit ${album.title}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-destructive/10"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveAlbum(album.id);
                }}
                aria-label={`Remove ${album.title}`}
              >
                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
            <div className="p-1 flex flex-col gap-1">
              {album.trackIds.length === 0 ? (
                <div className="text-xs text-muted-foreground px-2 py-3 text-center border border-dashed rounded-md">
                  drag tracks here
                </div>
              ) : (
                album.trackIds.map((trackId, index) => {
                  const track = filesById.get(trackId);
                  if (!track) return null;

                  return (
                    <div
                      key={track.id}
                      className="relative group"
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const payload = parseDragPayload(event);
                        if (payload && payload.trackId !== track.id) {
                          event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const payload = parseDragPayload(event);
                        if (!payload || payload.trackId === track.id) return;
                        const placement = placementForRowDrop(event);
                        onMoveTrackToAlbum(payload.trackId, album.id, placement, track.id);
                      }}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        draggable
                        onDragStart={(event) => {
                          const payload: DragPayload = {
                            trackId: track.id,
                            container: "album",
                            albumId: album.id,
                          };
                          event.dataTransfer.setData(
                            TRACK_DRAG_TYPE,
                            JSON.stringify(payload)
                          );
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        className={cn(
                          "justify-start h-auto py-2 px-2.5 w-full text-left font-normal pr-8",
                          selectedFileIds.has(track.id)
                            ? "bg-accent text-accent-foreground border-primary/40"
                            : selectedFileId === track.id
                              ? "bg-accent/50 text-accent-foreground"
                              : ""
                        )}
                        onClick={(e) => onSelectFile(album.id, track.id, e)}
                      >
                        <div className="flex items-center gap-2 w-full overflow-hidden">
                          <span className="w-5 text-[11px] text-muted-foreground">
                            {index + 1}
                          </span>
                          <FileMusic className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          <span className="truncate text-sm flex-1">{track.filename}</span>
                          {track.status === "saved" && (
                            <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
                          )}
                          {track.status === "error" && (
                            <AlertCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                          )}
                        </div>
                      </Button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveFile(track.id);
                        }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/10 rounded-full cursor-pointer"
                        title="Remove track"
                      >
                        <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
