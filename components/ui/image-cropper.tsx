"use client";

import { useState, useCallback, useRef } from "react";
import ReactCrop, {
  Crop,
  PixelCrop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
import { Button } from "./button";
import "react-image-crop/dist/ReactCrop.css";

interface ImageCropperProps {
  src: string;
  onCrop: (croppedImageBlob: Blob) => void;
  onCancel: () => void;
}

function centerAspectCrop(
  mediaWidth: number,
  mediaHeight: number,
  aspect: number
) {
  return centerCrop(
    makeAspectCrop(
      {
        unit: "%",
        width: 100,
      },
      aspect,
      mediaWidth,
      mediaHeight
    ),
    mediaWidth,
    mediaHeight
  );
}

export default function ImageCropper({
  src,
  onCrop,
  onCancel,
}: ImageCropperProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { width, height } = e.currentTarget;
      setCrop(centerAspectCrop(width, height, 1));
    },
    []
  );

  const getCroppedImg = useCallback(
    (image: HTMLImageElement, crop: PixelCrop): Promise<Blob> => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        throw new Error("No 2d context");
      }

      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;

      canvas.width = crop.width;
      canvas.height = crop.height;

      ctx.drawImage(
        image,
        crop.x * scaleX,
        crop.y * scaleY,
        crop.width * scaleX,
        crop.height * scaleY,
        0,
        0,
        crop.width,
        crop.height
      );

      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error("Canvas is empty"));
            }
          },
          "image/jpeg",
          0.95
        );
      });
    },
    []
  );

  const handleCrop = useCallback(async () => {
    if (completedCrop && imgRef.current) {
      try {
        const croppedImageBlob = await getCroppedImg(
          imgRef.current,
          completedCrop
        );
        onCrop(croppedImageBlob);
      } catch (error) {
        console.error("Error cropping image:", error);
      }
    }
  }, [completedCrop, getCroppedImg, onCrop]);

  return (
    <div className="space-y-4">
      <div className="w-80 h-80 flex items-center justify-center">
        <ReactCrop
          crop={crop}
          onChange={(c) => setCrop(c)}
          onComplete={(c) => setCompletedCrop(c)}
          aspect={1}
          keepSelection
        >
          <img
            ref={imgRef}
            alt="Crop preview"
            style={{ maxWidth: "320px", maxHeight: "320px" }}
            src={src}
            onLoad={onImageLoad}
          />
        </ReactCrop>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={handleCrop} disabled={!completedCrop}>
          Apply Crop
        </Button>
      </div>
    </div>
  );
}
