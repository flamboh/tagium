"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Refresh04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FloatingLabelInput } from "@/components/ui/floating-label-field";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import CoverArt from "@/features/editor/coverArt";
import { useAlbumCoverSync } from "@/features/editor/useAlbumCoverSync";
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
  onChange: Dispatch<SetStateAction<AlbumMetadataDraft>>;
  onClose: () => void;
  onSave: () => void;
  onSyncCoverToTracks?: () => Promise<void> | void;
  placeholder: SampleAlbumMetadata;
}

export default function AlbumMetadataDialog({
  open,
  mode,
  draft,
  onChange,
  onClose,
  onSave,
  onSyncCoverToTracks,
  placeholder,
}: AlbumMetadataDialogProps) {
  const [touchedFields, setTouchedFields] = useState({ title: false, artist: false });
  const [isProcessingCover, setIsProcessingCover] = useState(false);

  const coverSync = useAlbumCoverSync({
    disabled: isProcessingCover,
    onSync: onSyncCoverToTracks,
  });

  const canSyncCoverToTracks =
    mode === "edit" && draft.cover && draft.cover.length > 0 && onSyncCoverToTracks;

  const titleInvalid = !draft.title.trim();
  const artistInvalid = !draft.artist.trim();
  const formInvalid = titleInvalid || artistInvalid;

  const resetTransientState = () => {
    coverSync.cancel();
    setTouchedFields({ title: false, artist: false });
  };

  const handleClose = () => {
    if (isProcessingCover) return;
    resetTransientState();
    onClose();
  };

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
                  <RequiredAlbumField
                    id="album-title"
                    label="album title"
                    value={draft.title}
                    placeholder={placeholder.title}
                    error={touchedFields.title && titleInvalid ? "album title is required" : null}
                    onChange={(title) => onChange({ ...draft, title })}
                    onBlur={() => setTouchedFields((current) => ({ ...current, title: true }))}
                  />
                  <RequiredAlbumField
                    id="album-artist"
                    label="artist"
                    value={draft.artist}
                    placeholder={placeholder.artist}
                    error={touchedFields.artist && artistInvalid ? "artist is required" : null}
                    onChange={(artist) => onChange({ ...draft, artist })}
                    onBlur={() => setTouchedFields((current) => ({ ...current, artist: true }))}
                  />
                  <div className="mb-3">
                    <FloatingLabelInput
                      id="album-genre"
                      label="genre"
                      value={draft.genre}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          genre: event.target.value,
                        })
                      }
                      placeholder={placeholder.genre}
                    />
                  </div>
                  <FloatingLabelInput
                    id="album-year"
                    label="year"
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
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
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
                    <CoverSyncButton coverSync={coverSync} disabled={isProcessingCover} />
                  )
                }
              />
            </div>
          </div>
          <AlbumDialogFooter
            mode={mode}
            processingCover={isProcessingCover}
            formInvalid={formInvalid}
            onCancel={handleClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RequiredAlbumField({
  id,
  label,
  value,
  placeholder,
  error,
  onChange,
  onBlur,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  error: string | null;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const errorId = `${id}-error`;

  return (
    <div>
      <FloatingLabelInput
        id={id}
        label={label}
        required
        aria-required="true"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
      />
      <p id={errorId} className="h-4 text-xs leading-4 text-destructive" aria-live="polite">
        {error ?? ""}
      </p>
    </div>
  );
}

function CoverSyncButton({
  coverSync,
  disabled,
}: {
  coverSync: ReturnType<typeof useAlbumCoverSync>;
  disabled: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-label={coverSync.label}
          aria-busy={coverSync.isSyncing}
          className="absolute bottom-2 left-2 size-10 p-0 max-lg:[@media(max-height:700px)]:bottom-1.5 max-lg:[@media(max-height:700px)]:left-1.5"
          disabled={coverSync.isSyncing || disabled}
          onClick={coverSync.start}
        >
          <HugeiconsIcon
            icon={Refresh04Icon}
            strokeWidth={2}
            data-icon="inline-start"
            style={{
              transform: `rotate(${coverSync.rotation}deg)`,
              transition: "transform 0.6s cubic-bezier(0.87, 0, 0.13, 1)",
            }}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{coverSync.label}</TooltipContent>
    </Tooltip>
  );
}

function AlbumDialogFooter({
  mode,
  processingCover,
  formInvalid,
  onCancel,
}: {
  mode: AlbumMetadataDialogProps["mode"];
  processingCover: boolean;
  formInvalid: boolean;
  onCancel: () => void;
}) {
  const submitLabel = mode === "create" ? "create album" : "save album";

  return (
    <DialogFooter className="border-t p-5 flex items-center justify-end gap-2">
      <Button type="button" variant="outline" disabled={processingCover} onClick={onCancel}>
        cancel
      </Button>
      <Button
        type="submit"
        disabled={processingCover || formInvalid}
        aria-busy={processingCover || undefined}
      >
        {processingCover ? "processing cover" : submitLabel}
      </Button>
    </DialogFooter>
  );
}
