"use client";

import { useState, useEffect, useId, useRef } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import ImageCropper from "../ui/image-cropper";
import { Crop, Upload } from "lucide-react";
import { runCoverArtUploadTransaction } from "./coverArtProcessing";
import type { AudioMetadata } from "./types";

interface CoverArtProps {
  picture?: {
    format: string;
    data: Uint8Array;
    description?: string;
    type?: number;
  }[];
  onCoverUpload?: (
    picture: NonNullable<AudioMetadata["picture"]>,
    resetKey?: string | null,
  ) => void;
  onProcessingChange?: (processing: boolean) => void;
  coverOverlay?: React.ReactNode;
  size?: "default" | "compact";
  resetKey?: string | null;
  className?: string;
}

export default function CoverArt({
  picture,
  onCoverUpload,
  onProcessingChange,
  coverOverlay,
  size = "default",
  resetKey,
  className,
}: CoverArtProps) {
  const [uploadedCover, setUploadedCover] = useState<File | null>(null);
  const [tempImageForCropping, setTempImageForCropping] = useState<string | null>(null);
  const [showCropper, setShowCropper] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverErrorOpen, setCoverErrorOpen] = useState(false);
  const coverErrorId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverUploadIdRef = useRef(0);
  const processingChangeRef = useRef(onProcessingChange);
  useEffect(() => {
    processingChangeRef.current = onProcessingChange;
  }, [onProcessingChange]);

  const reportProcessing = (processing: boolean) => {
    setIsProcessing(processing);
    processingChangeRef.current?.(processing);
  };

  const processCover = async (file: File, uploadId: number) => {
    reportProcessing(true);

    try {
      const optimizedFile = await runCoverArtUploadTransaction(file, {
        isCurrent: () => uploadId === coverUploadIdRef.current,
        commit: (picture) => onCoverUpload?.(picture, resetKey),
      });
      if (!optimizedFile || uploadId !== coverUploadIdRef.current) return;
      setUploadedCover(optimizedFile);
      setCoverError(null);
      setCoverErrorOpen(false);
    } catch (error) {
      if (uploadId !== coverUploadIdRef.current) return;
      setCoverError(error instanceof Error ? error.message : "could not load cover art.");
      setCoverErrorOpen(true);
    } finally {
      if (uploadId === coverUploadIdRef.current) reportProcessing(false);
    }
  };

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const uploadId = ++coverUploadIdRef.current;
    void processCover(file, uploadId);
  };

  const handleCropComplete = (croppedBlob: Blob) => {
    const croppedFile = new File([croppedBlob], "cropped-cover.jpg", {
      type: "image/jpeg",
    });
    const uploadId = ++coverUploadIdRef.current;
    void processCover(croppedFile, uploadId);
    setShowCropper(false);
    if (tempImageForCropping) {
      URL.revokeObjectURL(tempImageForCropping);
      setTempImageForCropping(null);
    }
  };

  const handleCropCancel = () => {
    setShowCropper(false);
    if (tempImageForCropping) {
      URL.revokeObjectURL(tempImageForCropping);
      setTempImageForCropping(null);
    }
  };

  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const isCompact = size === "compact";
  const containerClassName = isCompact
    ? "flex-shrink-0 flex gap-2 md:h-full md:flex-col"
    : "flex-shrink-0 flex flex-col items-center gap-2 lg:grid lg:grid-rows-2 lg:items-start";

  useEffect(() => {
    coverUploadIdRef.current += 1;
    reportProcessing(false);
    setUploadedCover(null);
    setCoverError(null);
    setCoverErrorOpen(false);
    setShowCropper(false);
    setTempImageForCropping((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return null;
    });
  }, [resetKey]);

  useEffect(
    () => () => {
      coverUploadIdRef.current += 1;
      processingChangeRef.current?.(false);
    },
    [],
  );

  useEffect(() => {
    if (uploadedCover) {
      const url = URL.createObjectURL(uploadedCover);
      setCoverSrc(url);
      return () => URL.revokeObjectURL(url);
    }

    if (picture && picture.length > 0) {
      const blob = new Blob([picture[0].data as unknown as BlobPart], { type: picture[0].format });
      const url = URL.createObjectURL(blob);
      setCoverSrc(url);
      return () => URL.revokeObjectURL(url);
    }

    setCoverSrc(null);
  }, [uploadedCover, picture]);

  return (
    <div className={className ? `${containerClassName} ${className}` : containerClassName}>
      <div
        className={
          isCompact
            ? "relative w-24 md:w-44"
            : "relative size-[min(80vw,clamp(7.5rem,calc(75svh-25.3125rem),19.25rem))] max-lg:[@media(max-height:700px)]:size-24 lg:size-auto"
        }
      >
        {coverSrc ? (
          <img
            src={coverSrc}
            alt="album cover"
            className={
              isCompact
                ? "size-24 object-cover rounded-lg border md:size-44"
                : "size-full object-cover rounded-lg border lg:size-64"
            }
          />
        ) : (
          <div
            className={
              isCompact
                ? "size-24 bg-gray-200 rounded-lg border flex items-center justify-center text-gray-500 text-xs md:size-44"
                : "size-full bg-gray-200 rounded-lg border flex items-center justify-center text-gray-500 text-xs lg:size-64"
            }
          >
            no cover
          </div>
        )}
        {coverSrc && (
          <Popover open={showCropper} onOpenChange={setShowCropper}>
            <Tooltip>
              <PopoverTrigger asChild>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-label="crop cover art"
                    disabled={isProcessing}
                    className="absolute top-2 right-2 size-10 p-0 max-lg:[@media(max-height:700px)]:top-1.5 max-lg:[@media(max-height:700px)]:right-1.5"
                    onClick={() => {
                      if (tempImageForCropping) {
                        URL.revokeObjectURL(tempImageForCropping);
                      }
                      // Use uploaded cover first, then fall back to original picture
                      const imageUrl = uploadedCover
                        ? URL.createObjectURL(uploadedCover)
                        : coverSrc;
                      setTempImageForCropping(imageUrl);
                    }}
                  >
                    <Crop className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
              </PopoverTrigger>
              <TooltipContent>crop cover art</TooltipContent>
            </Tooltip>
            <PopoverContent
              className="w-auto max-w-[calc(100svw-1rem)] p-3 md:p-4"
              side="bottom"
              align="start"
            >
              {tempImageForCropping && (
                <ImageCropper
                  src={tempImageForCropping}
                  onCrop={handleCropComplete}
                  onCancel={handleCropCancel}
                />
              )}
            </PopoverContent>
          </Popover>
        )}
        {coverSrc && coverOverlay}
      </div>
      <div
        className={
          isCompact
            ? "flex min-w-0 flex-1"
            : "flex w-[min(80vw,clamp(7.5rem,calc(75svh-25.3125rem),19.25rem))] max-lg:[@media(max-height:700px)]:w-24 lg:w-auto lg:flex-none lg:flex-col lg:gap-2"
        }
      >
        <Input
          type="file"
          accept="image/jpeg,image/png"
          onChange={handleCoverUpload}
          className="hidden"
          ref={fileInputRef}
        />
        <Tooltip open={Boolean(coverError) && coverErrorOpen} onOpenChange={setCoverErrorOpen}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={isProcessing}
              aria-busy={isProcessing}
              aria-invalid={Boolean(coverError)}
              aria-describedby={coverError ? coverErrorId : undefined}
              className={
                isCompact
                  ? "h-24 w-full border-dashed border-2 flex flex-col items-center gap-1 px-2 hover:bg-accent/50 cursor-pointer md:h-full md:min-h-12 md:w-44 md:px-3"
                  : "h-10 w-full border-dashed border-2 flex gap-2 px-3 hover:bg-accent/50 cursor-pointer max-lg:[@media(max-height:700px)]:gap-1 lg:h-24 lg:w-64 lg:flex-col"
              }
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload
                className={
                  isCompact
                    ? "h-4 w-4 text-muted-foreground"
                    : "h-6 w-6 text-muted-foreground max-lg:[@media(max-height:700px)]:h-4 max-lg:[@media(max-height:700px)]:w-4"
                }
              />
              <span className="text-muted-foreground whitespace-nowrap text-[10px] md:text-xs">
                {isProcessing ? "processing cover" : "upload cover"}
              </span>
            </Button>
          </TooltipTrigger>
          {coverError && <TooltipContent side="bottom">{coverError}</TooltipContent>}
        </Tooltip>
        <p id={coverErrorId} className="sr-only" aria-live="polite">
          {coverError ?? ""}
        </p>
      </div>
    </div>
  );
}
