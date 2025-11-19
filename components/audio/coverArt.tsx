"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
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
}

export default function CoverArt({ picture, onCoverUpload }: CoverArtProps) {
  const [uploadedCover, setUploadedCover] = useState<File | null>(null);
  const [tempImageForCropping, setTempImageForCropping] = useState<
    string | null
  >(null);
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
    <div className="flex-shrink-0 grid grid-rows-2 gap-2">
      <div className="relative">
        {coverSrc ? (
          <Image
            src={coverSrc}
            alt="album cover"
            width={256}
            height={256}
            className="w-64 h-64 object-cover rounded-lg border"
            unoptimized
          />
        ) : (
          <div className="w-64 h-64 bg-gray-200 rounded-lg border flex items-center justify-center text-gray-500 text-xs">
            no cover
          </div>
        )}
        {coverSrc && (
          <Popover open={showCropper} onOpenChange={setShowCropper}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                className="absolute top-2 right-2"
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
            </PopoverTrigger>
            <PopoverContent className="w-auto p-4" side="right">
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
      </div>
      <div className="flex flex-col gap-2">
        <Input
          type="file"
          accept="image/*"
          onChange={handleCoverUpload}
          className="hidden"
          ref={fileInputRef}
        />
        <Button
          variant="outline"
          className="w-64 h-24 border-dashed border-2 flex flex-col gap-2 hover:bg-accent/50 cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-6 w-6 text-muted-foreground" />
          <span className="text-muted-foreground text-xs">upload cover</span>
        </Button>
      </div>
    </div>
  );
}
