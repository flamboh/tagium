"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import CoverArt from "@/features/editor/coverArt";
import { AudioMetadata } from "@/features/library/types";
import type { SampleAlbumMetadata } from "@/features/editor/sampleMetadata";

export interface AlbumMetadataDraft {
  title: string;
  artist: string;
  genre: string;
  year?: number;
  cover?: AudioMetadata["picture"];
}

export interface AlbumMetadataDialogProps {
  instanceKey?: string;
  open: boolean;
  mode: "create" | "edit";
  draft: AlbumMetadataDraft;
  trackCount: number;
  onChange: Dispatch<SetStateAction<AlbumMetadataDraft>>;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onSyncCoverToTracks?: () => Promise<void> | void;
  placeholder: SampleAlbumMetadata;
}

export default function AlbumMetadataDialog({
  open,
  mode,
  draft,
  trackCount,
  onChange,
  onClose,
  onSave,
  onDelete,
  onSyncCoverToTracks,
  placeholder,
}: AlbumMetadataDialogProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [touchedFields, setTouchedFields] = useState({ title: false, artist: false });
  const [isSyncingCover, setIsSyncingCover] = useState(false);
  const [isProcessingCover, setIsProcessingCover] = useState(false);
  const [syncCoverRotation, setSyncCoverRotation] = useState(0);
  const syncCoverTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const syncCoverRunRef = useRef(0);
  const canSyncCoverToTracks =
    mode === "edit" && draft.cover && draft.cover.length > 0 && onSyncCoverToTracks;
  const syncCoverLabel = isSyncingCover ? "syncing cover to tracks" : "sync cover to tracks";
  const placeholderClassName = "placeholder:text-muted-foreground/45";
  const titleInvalid = !draft.title.trim();
  const artistInvalid = !draft.artist.trim();
  const formInvalid = titleInvalid || artistInvalid;

  const cancelSyncCoverFeedback = (resetVisualState: boolean) => {
    syncCoverRunRef.current += 1;
    if (syncCoverTimerRef.current !== null) {
      globalThis.clearTimeout(syncCoverTimerRef.current);
      syncCoverTimerRef.current = null;
    }
    if (resetVisualState) {
      setIsSyncingCover(false);
      setSyncCoverRotation(0);
    }
  };

  const resetTransientState = () => {
    cancelSyncCoverFeedback(true);
    setShowDeleteConfirm(false);
    setTouchedFields({ title: false, artist: false });
  };

  const handleClose = () => {
    if (isProcessingCover) return;
    resetTransientState();
    onClose();
  };

  const handleSyncCoverToTracks = () => {
    if (!onSyncCoverToTracks) return;
    if (isSyncingCover || isProcessingCover) return;

    const startedAt = performance.now();
    const syncRun = syncCoverRunRef.current + 1;
    syncCoverRunRef.current = syncRun;
    setSyncCoverRotation((rotation) => rotation + 360);
    setIsSyncingCover(true);
    const result = onSyncCoverToTracks();

    void Promise.resolve(result).finally(() => {
      if (syncCoverRunRef.current !== syncRun) return;
      const elapsed = performance.now() - startedAt;
      const remaining = Math.max(0, 650 - elapsed);
      syncCoverTimerRef.current = globalThis.setTimeout(() => {
        if (syncCoverRunRef.current !== syncRun) return;
        syncCoverTimerRef.current = null;
        setIsSyncingCover(false);
      }, remaining);
    });
  };

  useEffect(
    () => () => {
      cancelSyncCoverFeedback(false);
    },
    [],
  );

  const handleCoverUpload = (cover: NonNullable<AudioMetadata["picture"]>) => {
    onChange((currentDraft) => ({ ...currentDraft, cover }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
    >
      <DialogContent className="max-w-2xl p-0 gap-0 max-h-[85vh] overflow-hidden">
        <form
          className="flex flex-col gap-0"
          onSubmit={(event) => {
            event.preventDefault();
            if (isProcessingCover) return;
            if (formInvalid) return;
            resetTransientState();
            onSave();
          }}
        >
          <DialogHeader className="border-b p-5">
            <DialogTitle>{mode === "create" ? "create album" : "edit album"}</DialogTitle>
            <DialogDescription className="sr-only">
              edit album metadata including cover art.
            </DialogDescription>
          </DialogHeader>
          <div className="p-5 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-[11rem_minmax(0,1fr)] gap-4 md:min-h-[236px] items-stretch">
              <div className="order-2 min-w-0 h-full flex flex-col justify-between gap-3 md:order-2">
                <div className="flex flex-col gap-0">
                  <div>
                    <label htmlFor="album-title" className="block text-sm font-medium mb-1">
                      album title:{" "}
                      <span className="text-destructive" aria-hidden="true">
                        *
                      </span>
                      <span className="sr-only"> required</span>
                    </label>
                    <Input
                      id="album-title"
                      required
                      aria-required="true"
                      value={draft.title}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          title: event.target.value,
                        })
                      }
                      onBlur={() => setTouchedFields((current) => ({ ...current, title: true }))}
                      placeholder={placeholder.title}
                      aria-invalid={touchedFields.title && titleInvalid}
                      aria-describedby={
                        touchedFields.title && titleInvalid ? "album-title-error" : undefined
                      }
                      className={placeholderClassName}
                    />
                    <p
                      id="album-title-error"
                      className="h-4 text-xs leading-4 text-destructive"
                      aria-live="polite"
                    >
                      {touchedFields.title && titleInvalid ? "album title is required" : ""}
                    </p>
                  </div>
                  <div>
                    <label htmlFor="album-artist" className="block text-sm font-medium mb-1">
                      artist:{" "}
                      <span className="text-destructive" aria-hidden="true">
                        *
                      </span>
                      <span className="sr-only"> required</span>
                    </label>
                    <Input
                      id="album-artist"
                      required
                      aria-required="true"
                      value={draft.artist}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          artist: event.target.value,
                        })
                      }
                      onBlur={() => setTouchedFields((current) => ({ ...current, artist: true }))}
                      placeholder={placeholder.artist}
                      aria-invalid={touchedFields.artist && artistInvalid}
                      aria-describedby={
                        touchedFields.artist && artistInvalid ? "album-artist-error" : undefined
                      }
                      className={placeholderClassName}
                    />
                    <p
                      id="album-artist-error"
                      className="h-4 text-xs leading-4 text-destructive"
                      aria-live="polite"
                    >
                      {touchedFields.artist && artistInvalid ? "artist is required" : ""}
                    </p>
                  </div>
                  <div className="mb-3">
                    <label htmlFor="album-genre" className="block text-sm font-medium mb-1">
                      genre:
                    </label>
                    <Input
                      id="album-genre"
                      value={draft.genre}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          genre: event.target.value,
                        })
                      }
                      placeholder={placeholder.genre}
                      className={placeholderClassName}
                    />
                  </div>
                  <div>
                    <label htmlFor="album-year" className="block text-sm font-medium mb-1">
                      year:
                    </label>
                    <Input
                      id="album-year"
                      type="number"
                      min={0}
                      max={9999}
                      step={1}
                      value={draft.year ?? ""}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          year: event.target.value ? Number(event.target.value) : undefined,
                        })
                      }
                      placeholder={placeholder.year}
                      className={`${placeholderClassName} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                    />
                  </div>
                </div>
              </div>
              <CoverArt
                picture={draft.cover}
                onCoverUpload={handleCoverUpload}
                onProcessingChange={setIsProcessingCover}
                size="compact"
                className="order-1 md:order-1"
                coverOverlay={
                  canSyncCoverToTracks && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          aria-label={syncCoverLabel}
                          aria-busy={isSyncingCover}
                          className="absolute bottom-2 left-2 size-10 p-0 max-lg:[@media(max-height:700px)]:bottom-1.5 max-lg:[@media(max-height:700px)]:left-1.5"
                          disabled={isSyncingCover || isProcessingCover}
                          onClick={handleSyncCoverToTracks}
                        >
                          <RefreshCw
                            data-icon="inline-start"
                            style={{
                              transform: `rotate(${syncCoverRotation}deg)`,
                              transition: "transform 0.6s cubic-bezier(0.87, 0, 0.13, 1)",
                            }}
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">{syncCoverLabel}</TooltipContent>
                    </Tooltip>
                  )
                }
              />
            </div>
          </div>
          <DialogFooter className="border-t p-5 flex items-center justify-end gap-2">
            {showDeleteConfirm ? (
              <>
                <span className="text-sm text-muted-foreground mr-auto">
                  delete album and all {trackCount} track{trackCount !== 1 ? "s" : ""}?
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isProcessingCover}
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  keep album
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isProcessingCover}
                  onClick={() => {
                    resetTransientState();
                    onDelete?.();
                  }}
                >
                  delete
                </Button>
              </>
            ) : (
              <>
                {mode === "edit" && onDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isProcessingCover}
                    className="mr-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    delete album
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={isProcessingCover}
                  onClick={handleClose}
                >
                  cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isProcessingCover || formInvalid}
                  aria-busy={isProcessingCover || undefined}
                >
                  {isProcessingCover
                    ? "processing cover"
                    : mode === "create"
                      ? "create album"
                      : "save album"}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
