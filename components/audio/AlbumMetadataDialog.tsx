"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  cover?: AudioMetadata["picture"];
  syncTrackNumbers: boolean;
  syncFilenames: boolean;
}

interface AlbumMetadataDialogProps {
  open: boolean;
  mode: "create" | "edit";
  draft: AlbumMetadataDraft;
  onChange: (draft: AlbumMetadataDraft) => void;
  onClose: () => void;
  onSave: () => void;
}

export default function AlbumMetadataDialog({
  open,
  mode,
  draft,
  onChange,
  onClose,
  onSave,
}: AlbumMetadataDialogProps) {
  const trackOrderId = useId();
  const syncFilenamesId = useId();

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
            description: "Uploaded cover",
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
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-w-2xl p-0 gap-0 max-h-[85vh] overflow-hidden">
        <form
          className="flex flex-col gap-0"
          onSubmit={(event) => {
            event.preventDefault();
            onSave();
          }}
        >
          <DialogHeader className="border-b p-5">
            <DialogTitle>{mode === "create" ? "create album" : "edit album"}</DialogTitle>
            <DialogDescription className="sr-only">
              Edit album metadata including cover art and track numbering behavior.
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
                    />
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
                    />
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
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={trackOrderId}
                      checked={draft.syncTrackNumbers}
                      onCheckedChange={(checked) =>
                        onChange({
                          ...draft,
                          syncTrackNumbers: checked === true,
                        })
                      }
                      className="mt-0.5"
                    />
                    <label htmlFor={trackOrderId} className="text-sm leading-5 cursor-pointer">
                      use sidebar order as track number
                    </label>
                  </div>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id={syncFilenamesId}
                      checked={draft.syncFilenames}
                      onCheckedChange={(checked) =>
                        onChange({
                          ...draft,
                          syncFilenames: checked === true,
                        })
                      }
                      className="mt-0.5"
                    />
                    <label htmlFor={syncFilenamesId} className="text-sm leading-5 cursor-pointer">
                      sync filenames with track titles
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="border-t p-5 flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              cancel
            </Button>
            <Button type="submit">{mode === "create" ? "create album" : "save album"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
