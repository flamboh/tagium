"use client";

import { useState } from "react";
import Image from "next/image";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

interface CoverArtProps {
  picture?: {
    format: string;
    data: Uint8Array;
    description?: string;
  }[];
  onCoverUpload?: (file: File) => void;
}

export default function CoverArt({ picture, onCoverUpload }: CoverArtProps) {
  const [uploadedCover, setUploadedCover] = useState<File | null>(null);

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith("image/")) {
      setUploadedCover(file);
      onCoverUpload?.(file);
    }
  };

  const getCoverSrc = () => {
    if (uploadedCover) {
      return URL.createObjectURL(uploadedCover);
    }
    if (picture && picture.length > 0) {
      return `data:${picture[0].format};base64,${btoa(
        String.fromCharCode(...picture[0].data)
      )}`;
    }
    return null;
  };

  const coverSrc = getCoverSrc();

  return (
    <div className="flex-shrink-0 grid grid-rows-2 gap-2">
      {coverSrc ? (
        <Image
          src={coverSrc}
          alt="Album cover"
          width={256}
          height={256}
          className="w-64 h-64 object-cover rounded-lg border"
          unoptimized
        />
      ) : (
        <div className="w-64 h-64 bg-gray-200 rounded-lg border flex items-center justify-center text-gray-500 text-xs">
          No cover
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label>Upload Cover</Label>
        <Input
          type="file"
          accept="image/*"
          onChange={handleCoverUpload}
        />
      </div>
    </div>
  );
}
