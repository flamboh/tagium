"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import ImageCropper from "../ui/image-cropper";
import { Crop, Upload } from "lucide-react";

interface CoverArtProps {
  picture?: {
    format: string;
    data: Uint8Array;
    description?: string;
    type?: number;
  }[];
  onCoverUpload?: (file: File) => void;
  coverOverlay?: React.ReactNode;
  size?: "default" | "compact";
  resetKey?: string | null;
  className?: string;
}

export default function CoverArt({
  picture,
  onCoverUpload,
  coverOverlay,
  size = "default",
  resetKey,
  className,
}: CoverArtProps) {
  const [uploadedCover, setUploadedCover] = useState<File | null>(null);
  const [tempImageForCropping, setTempImageForCropping] = useState<string | null>(null);
  const [showCropper, setShowCropper] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setUploadedCover(file);
      onCoverUpload?.(file);

      // Reset the input value to allow uploading the same file again
      e.target.value = "";
    }
  };

  const handleCropComplete = (croppedBlob: Blob) => {
    const croppedFile = new File([croppedBlob], "cropped-cover.jpg", {
      type: "image/jpeg",
    });
    setUploadedCover(croppedFile);
    onCoverUpload?.(croppedFile);
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
    setUploadedCover(null);
    setShowCropper(false);
    setTempImageForCropping((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      return null;
    });
  }, [resetKey]);

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
          accept="image/*"
          onChange={handleCoverUpload}
          className="hidden"
          ref={fileInputRef}
        />
        <Button
          type="button"
          variant="outline"
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
            upload cover
          </span>
        </Button>
      </div>
    </div>
  );
}
