"use client";

import { useEffect, useId, useReducer, useRef, useState } from "react";
import { CropIcon, Upload01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import ImageCropper from "@/components/ui/image-cropper";
import { runCoverArtUploadTransaction } from "@/features/editor/coverArtProcessing";
import {
  coverArtReducer,
  initialCoverArtState,
  type CropSource,
} from "@/features/editor/coverArtState";
import type { AudioMetadata } from "@/features/library/types";

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
  disabled?: boolean;
  disabledReason?: string;
}

const coverArtClasses = {
  compact: {
    container: "flex-shrink-0 flex gap-2 md:h-full md:flex-col",
    frame: "relative w-24 md:w-44",
    image: "size-24 object-cover rounded-lg border md:size-44",
    placeholder:
      "size-24 bg-muted rounded-lg border flex items-center justify-center text-muted-foreground text-xs md:size-44",
    uploadRow: "flex min-w-0 flex-1",
    uploadButton:
      "h-24 w-full border-dashed border-2 flex flex-col items-center gap-1 px-2 hover:bg-accent/50 cursor-pointer md:h-full md:min-h-12 md:w-44 md:px-3",
    uploadIcon: "h-4 w-4 text-muted-foreground",
  },
  default: {
    container: "flex-shrink-0 flex flex-col items-center gap-2 lg:items-start",
    frame:
      "relative size-[min(80vw,clamp(7.5rem,calc(75svh-25.3125rem),19.25rem))] max-lg:[@media(max-height:700px)]:size-24 lg:size-auto",
    image: "size-full object-cover rounded-lg border lg:size-64",
    placeholder:
      "size-full bg-muted rounded-lg border flex items-center justify-center text-muted-foreground text-xs lg:size-64",
    uploadRow:
      "flex w-[min(80vw,clamp(7.5rem,calc(75svh-25.3125rem),19.25rem))] max-lg:[@media(max-height:700px)]:w-24 lg:w-auto lg:flex-1 lg:flex-col lg:gap-2",
    uploadButton:
      "h-10 w-full border-dashed border-2 flex gap-2 px-3 hover:bg-accent/50 cursor-pointer max-lg:[@media(max-height:700px)]:gap-1 lg:h-auto lg:min-h-24 lg:w-64 lg:flex-1 lg:flex-col",
    uploadIcon:
      "h-6 w-6 text-muted-foreground max-lg:[@media(max-height:700px)]:h-4 max-lg:[@media(max-height:700px)]:w-4",
  },
};

export default function CoverArt({
  picture,
  onCoverUpload,
  onProcessingChange,
  coverOverlay,
  size = "default",
  resetKey,
  className,
  disabled = false,
  disabledReason,
}: CoverArtProps) {
  const [state, dispatch] = useReducer(coverArtReducer, initialCoverArtState);

  const {
    uploadedCover,
    cropSource,
    isCropperOpen,
    isProcessing,
    error: coverError,
    isErrorOpen: coverErrorOpen,
  } = state;

  const disabledReasonId = useId();
  const coverUploadIdRef = useRef(0);
  const processingChangeRef = useRef(onProcessingChange);
  useEffect(() => {
    processingChangeRef.current = onProcessingChange;
  }, [onProcessingChange]);

  const processCover = async (file: File, uploadId: number, closeCropper = false) => {
    dispatch({ type: "uploadStarted", uploadId, closeCropper });
    processingChangeRef.current?.(true);

    try {
      const optimizedFile = await runCoverArtUploadTransaction(file, {
        isCurrent: () => uploadId === coverUploadIdRef.current,
        commit: (picture) => onCoverUpload?.(picture, resetKey),
      });

      if (!optimizedFile || uploadId !== coverUploadIdRef.current) return;
      dispatch({ type: "uploadSucceeded", uploadId, file: optimizedFile });
    } catch (error) {
      if (uploadId !== coverUploadIdRef.current) return;
      dispatch({
        type: "uploadFailed",
        uploadId,
        message: error instanceof Error ? error.message : "could not load cover art.",
      });
    } finally {
      if (uploadId === coverUploadIdRef.current) processingChangeRef.current?.(false);
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
    void processCover(croppedFile, uploadId, true);
  };

  const handleCropCancel = () => {
    dispatch({ type: "cropClosed" });
  };

  const [coverSrc, setCoverSrc] = useState<string | null>(null);
  const classes = coverArtClasses[size];

  useEffect(() => {
    const uploadId = ++coverUploadIdRef.current;
    dispatch({ type: "reset", uploadId });
    processingChangeRef.current?.(false);
  }, [resetKey]);

  useEffect(() => {
    if (!cropSource?.owned) return;

    return () => URL.revokeObjectURL(cropSource.url);
  }, [cropSource]);

  useEffect(
    () => () => {
      coverUploadIdRef.current += 1;
      processingChangeRef.current?.(false);
    },
    [],
  );

  useEffect(() => {
    if (uploadedCover) {
      // The cleanup below revokes this exact URL when the cover changes or the component unmounts.
      // react-doctor-disable-next-line react-doctor/no-create-object-url-without-revoke
      const url = URL.createObjectURL(uploadedCover);
      setCoverSrc(url);

      return () => URL.revokeObjectURL(url);
    }

    if (picture && picture.length > 0) {
      const blob = new Blob([Uint8Array.from(picture[0].data)], { type: picture[0].format });
      // The cleanup below revokes this exact URL when the picture changes or the component unmounts.
      // react-doctor-disable-next-line react-doctor/no-create-object-url-without-revoke
      const url = URL.createObjectURL(blob);
      setCoverSrc(url);

      return () => URL.revokeObjectURL(url);
    }

    setCoverSrc(null);
  }, [uploadedCover, picture]);

  return (
    <div className={className ? `${classes.container} ${className}` : classes.container}>
      <div className={classes.frame}>
        {coverSrc ? (
          <img src={coverSrc} alt="album cover" className={classes.image} />
        ) : (
          <div className={classes.placeholder}>no cover</div>
        )}
        {coverSrc && (
          <Popover
            open={isCropperOpen}
            onOpenChange={(open) => {
              if (!open) {
                dispatch({ type: "cropClosed" });

                return;
              }

              const source: CropSource = uploadedCover
                ? { url: URL.createObjectURL(uploadedCover), owned: true }
                : { url: coverSrc, owned: false };

              dispatch({ type: "cropOpened", source });
            }}
          >
            <Tooltip>
              <PopoverTrigger asChild>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-label="crop cover art"
                    disabled={isProcessing || disabled}
                    aria-describedby={disabled && disabledReason ? disabledReasonId : undefined}
                    className="absolute top-2 right-2 size-10 p-0 max-lg:[@media(max-height:700px)]:top-1.5 max-lg:[@media(max-height:700px)]:right-1.5"
                  >
                    <HugeiconsIcon icon={CropIcon} strokeWidth={2} className="h-4 w-4" />
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
              {cropSource && (
                <ImageCropper
                  src={cropSource.url}
                  onCrop={handleCropComplete}
                  onCancel={handleCropCancel}
                />
              )}
            </PopoverContent>
          </Popover>
        )}
        {coverSrc && coverOverlay}
      </div>
      <CoverUploadRow
        classes={classes}
        disabled={disabled}
        disabledReason={disabledReason}
        disabledReasonId={disabledReasonId}
        isProcessing={isProcessing}
        coverError={coverError}
        errorOpen={coverErrorOpen}
        onErrorOpenChange={(open) => dispatch({ type: "errorOpenChanged", open })}
        onFileChange={handleCoverUpload}
      />
    </div>
  );
}

function CoverUploadRow({
  classes,
  disabled,
  disabledReason,
  disabledReasonId,
  isProcessing,
  coverError,
  errorOpen,
  onErrorOpenChange,
  onFileChange,
}: {
  classes: (typeof coverArtClasses)[keyof typeof coverArtClasses];
  disabled: boolean;
  disabledReason?: string;
  disabledReasonId: string;
  isProcessing: boolean;
  coverError: string | null;
  errorOpen: boolean;
  onErrorOpenChange: (open: boolean) => void;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const coverErrorId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const linkedReason = disabled ? disabledReason : undefined;
  const tooltip = coverError ?? linkedReason;

  const describedBy = [coverError ? coverErrorId : null, linkedReason ? disabledReasonId : null]
    .filter(Boolean)
    .join(" ");

  const label = isProcessing ? "processing cover" : disabled ? "cover linked" : "upload cover";

  return (
    <div className={classes.uploadRow}>
      <Input
        type="file"
        accept="image/jpeg,image/png"
        onChange={onFileChange}
        disabled={disabled}
        className="hidden"
        ref={fileInputRef}
      />
      <Tooltip open={Boolean(tooltip) && errorOpen} onOpenChange={onErrorOpenChange}>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            data-cover-upload
            disabled={isProcessing || disabled}
            aria-busy={isProcessing}
            aria-invalid={Boolean(coverError)}
            aria-describedby={describedBy || undefined}
            className={classes.uploadButton}
            onClick={() => fileInputRef.current?.click()}
          >
            <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} className={classes.uploadIcon} />
            <span className="text-muted-foreground whitespace-nowrap text-[10px] md:text-xs">
              {label}
            </span>
          </Button>
        </TooltipTrigger>
        {tooltip && <TooltipContent side="bottom">{tooltip}</TooltipContent>}
      </Tooltip>
      <p id={coverErrorId} className="sr-only" aria-live="polite">
        {coverError ?? ""}
      </p>
      {linkedReason && (
        <p id={disabledReasonId} className="sr-only">
          {linkedReason}
        </p>
      )}
    </div>
  );
}
