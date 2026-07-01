"use client";

import { useState } from "react";
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
import CoverArt from "./coverArt";
import { AudioMetadata } from "./types";

export interface AlbumMetadataDraft {
  title: string;
  artist: string;
  genre: string;
  year?: number;
  cover?: AudioMetadata["picture"];
}

interface AlbumMetadataDialogProps {
  open: boolean;
  mode: "create" | "edit";
  draft: AlbumMetadataDraft;
  trackCount: number;
  onChange: (draft: AlbumMetadataDraft) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  onApplyCover?: () => void;
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
  onApplyCover,
}: AlbumMetadataDialogProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const canApplyCover = mode === "edit" && draft.cover && draft.cover.length > 0 && onApplyCover;

  const handleCoverUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      const uint8Array = new Uint8Array(arrayBuffer);
      onChange({
        ...draft,
        cover: [
          {
            format: file.type,
            type: 3,
            data: uint8Array,
            description: "uploaded cover",
          },
        ],
      });
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setShowDeleteConfirm(false);
          setShowErrors(false);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-2xl p-0 gap-0 max-h-[85vh] overflow-hidden">
        <form
          className="flex flex-col gap-0"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.title.trim() || !draft.artist.trim()) {
              setShowErrors(true);
              return;
            }
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
              <CoverArt picture={draft.cover} onCoverUpload={handleCoverUpload} size="compact" />
              <div className="min-w-0 h-full flex flex-col justify-between gap-3">
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">album title:</label>
                    <Input
                      value={draft.title}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          title: event.target.value,
                        })
                      }
                      placeholder="My Album"
                      aria-invalid={showErrors && !draft.title.trim()}
                    />
                    {showErrors && !draft.title.trim() && (
                      <p className="text-xs text-destructive mt-1">album title is required</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">artist:</label>
                    <Input
                      value={draft.artist}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          artist: event.target.value,
                        })
                      }
                      placeholder="Artist Name"
                      aria-invalid={showErrors && !draft.artist.trim()}
                    />
                    {showErrors && !draft.artist.trim() && (
                      <p className="text-xs text-destructive mt-1">artist is required</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">genre:</label>
                    <Input
                      value={draft.genre}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          genre: event.target.value,
                        })
                      }
                      placeholder="House"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">year:</label>
                    <Input
                      type="number"
                      value={draft.year ?? ""}
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          year: event.target.value ? Number(event.target.value) : undefined,
                        })
                      }
                      placeholder="2024"
                      className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="border-t p-5 flex items-center justify-end gap-2">
            {showDeleteConfirm ? (
              <>
                <span className="text-sm text-muted-foreground mr-auto">
                  delete album and all {trackCount} track{trackCount !== 1 ? "s" : ""}?
                </span>
                <Button type="button" variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                  keep album
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setShowDeleteConfirm(false);
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
                    className="mr-auto text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setShowDeleteConfirm(true)}
                  >
                    delete album
                  </Button>
                )}
                {canApplyCover && (
                  <Button type="button" variant="outline" onClick={onApplyCover}>
                    apply cover to tracks
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={onClose}>
                  cancel
                </Button>
                <Button type="submit">{mode === "create" ? "create album" : "save album"}</Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
