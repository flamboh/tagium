import type { AudioMetadata } from "@/features/library/types";

export const MAX_COVER_ART_EDGE = 1_600;
export const MAX_COVER_ART_PIXELS = 16_000_000;
export const MAX_COVER_ART_UPLOAD_BYTES = 25 * 1024 * 1024;
const COVER_ART_REENCODE_THRESHOLD_BYTES = 2 * 1024 * 1024;
const COVER_ART_HEADER_BYTES = 1024 * 1024;
const supportedCoverArtTypes = new Set(["image/jpeg", "image/jpg", "image/png"]);
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

const startsWithBytes = (bytes: Uint8Array, prefix: readonly number[]) => {
  if (bytes.length < prefix.length) return false;

  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
};

export const getCoverArtTargetSize = (
  width: number,
  height: number,
  maxEdge = MAX_COVER_ART_EDGE,
) => {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

export const validateCoverArtUpload = (file: File) => {
  if (!supportedCoverArtTypes.has(file.type.toLowerCase())) {
    throw new Error("cover art image must be a jpeg or png.");
  }
  if (file.size > MAX_COVER_ART_UPLOAD_BYTES) {
    throw new Error("cover art must be 25 MB or smaller.");
  }
};

export const normalizeCoverArtType = (contentType: string) => {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!supportedCoverArtTypes.has(normalized)) {
    throw new Error("cover art image must be a jpeg or png.");
  }
  return normalized === "image/jpg" ? "image/jpeg" : normalized;
};

export const validateCoverArtDimensions = (width: number, height: number) => {
  if (width <= 0 || height <= 0 || width * height > MAX_COVER_ART_PIXELS) {
    throw new Error("cover art must be 16 megapixels or smaller.");
  }
};

const readPngDimensions = (bytes: Uint8Array) => {
  if (bytes.length < 24 || !startsWithBytes(bytes, pngSignature)) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const readJpegDimensions = (bytes: Uint8Array) => {
  if (bytes.length < 11 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda || offset + 2 > bytes.length) break;
    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2) break;

    if (jpegStartOfFrameMarkers.has(marker) && offset + 7 <= bytes.length) {
      return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
    }
    offset += segmentLength;
  }

  return undefined;
};

export const readCoverArtDimensions = async (file: File) => {
  validateCoverArtUpload(file);
  const bytes = new Uint8Array(await file.slice(0, COVER_ART_HEADER_BYTES).arrayBuffer());
  const dimensions =
    file.type.toLowerCase() === "image/png" ? readPngDimensions(bytes) : readJpegDimensions(bytes);
  if (!dimensions) throw new Error("cover art has an invalid or unsupported image header.");
  return dimensions;
};

const canvasToBlob = (canvas: HTMLCanvasElement, type: "image/jpeg" | "image/png") =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("could not optimize cover art."));
      },
      type,
      0.9,
    );
  });

export const optimizeCoverArt = async (file: File) => {
  validateCoverArtUpload(file);
  const encodedDimensions = await readCoverArtDimensions(file);
  validateCoverArtDimensions(encodedDimensions.width, encodedDimensions.height);
  const image = await createImageBitmap(file);

  try {
    const target = getCoverArtTargetSize(image.width, image.height);
    const shouldReencode =
      target.width !== image.width ||
      target.height !== image.height ||
      file.size > COVER_ART_REENCODE_THRESHOLD_BYTES;
    if (!shouldReencode) return file;

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("could not optimize cover art.");
    context.drawImage(image, 0, 0, target.width, target.height);

    const outputType = file.type.toLowerCase() === "image/png" ? "image/png" : "image/jpeg";
    const blob = await canvasToBlob(canvas, outputType);
    return new File([blob], outputType === "image/png" ? "cover.png" : "cover.jpg", {
      type: outputType,
    });
  } finally {
    image.close();
  }
};

export const coverArtFileToPicture = async (
  file: File,
  description = "uploaded cover",
): Promise<NonNullable<AudioMetadata["picture"]>> => [
  {
    format: normalizeCoverArtType(file.type),
    type: 3,
    data: new Uint8Array(await file.arrayBuffer()),
    description,
  },
];

interface CoverArtUploadTransactionOptions {
  isCurrent: () => boolean;
  commit: (picture: NonNullable<AudioMetadata["picture"]>) => void;
  optimize?: (file: File) => Promise<File>;
  description?: string;
}

/**
 * Keeps optimization, byte conversion, and the parent commit in one identity-checked operation.
 * A reset or selection change can invalidate the operation at either await boundary.
 */
export const runCoverArtUploadTransaction = async (
  file: File,
  {
    isCurrent,
    commit,
    optimize = optimizeCoverArt,
    description = "uploaded cover",
  }: CoverArtUploadTransactionOptions,
) => {
  const optimizedFile = await optimize(file);
  if (!isCurrent()) return null;

  const picture = await coverArtFileToPicture(optimizedFile, description);
  if (!isCurrent()) return null;

  commit(picture);
  return optimizedFile;
};
