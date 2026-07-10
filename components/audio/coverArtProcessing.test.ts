import { describe, expect, it, vi } from "vite-plus/test";
import {
  MAX_COVER_ART_EDGE,
  MAX_COVER_ART_PIXELS,
  MAX_COVER_ART_UPLOAD_BYTES,
  getCoverArtTargetSize,
  readCoverArtDimensions,
  runCoverArtUploadTransaction,
  validateCoverArtUpload,
  validateCoverArtDimensions,
} from "./coverArtProcessing";

describe("cover art processing", () => {
  it("scales oversized covers without changing their aspect ratio", () => {
    expect(getCoverArtTargetSize(4_000, 2_000)).toEqual({ width: 1_600, height: 800 });
    expect(getCoverArtTargetSize(800, 2_400)).toEqual({ width: 533, height: 1_600 });
  });

  it("does not upscale covers already within the target size", () => {
    expect(getCoverArtTargetSize(1_000, 1_000)).toEqual({ width: 1_000, height: 1_000 });
    expect(MAX_COVER_ART_EDGE).toBe(1_600);
  });

  it("allows generous image uploads but rejects pathological inputs", () => {
    expect(() =>
      validateCoverArtUpload(new File([new Uint8Array(10)], "cover.jpg", { type: "image/jpeg" })),
    ).not.toThrow();
    expect(() =>
      validateCoverArtUpload(
        new File([new Uint8Array(MAX_COVER_ART_UPLOAD_BYTES + 1)], "huge.jpg", {
          type: "image/jpeg",
        }),
      ),
    ).toThrow("25 MB");
    expect(() =>
      validateCoverArtUpload(new File(["text"], "cover.txt", { type: "text/plain" })),
    ).toThrow("image");
  });

  it("reads dimensions from encoded PNG and JPEG headers before decoding", async () => {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    new DataView(png.buffer).setUint32(16, 4_000);
    new DataView(png.buffer).setUint32(20, 3_000);

    const jpeg = Uint8Array.of(
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      0x0b,
      0xb8,
      0x0f,
      0xa0,
      0x03,
    );

    await expect(
      readCoverArtDimensions(new File([png], "cover.png", { type: "image/png" })),
    ).resolves.toEqual({ width: 4_000, height: 3_000 });
    await expect(
      readCoverArtDimensions(new File([jpeg], "cover.jpg", { type: "image/jpeg" })),
    ).resolves.toEqual({ width: 4_000, height: 3_000 });
  });

  it("rejects encoded images with unsafe decoded dimensions", () => {
    expect(() => validateCoverArtDimensions(4_000, 4_000)).not.toThrow();
    expect(MAX_COVER_ART_PIXELS).toBe(16_000_000);
    expect(() => validateCoverArtDimensions(8_000, 8_000)).toThrow("16 megapixels");
  });

  it("does not read or commit optimized cover bytes after the upload identity changes", async () => {
    const source = new File(["source"], "cover.jpg", { type: "image/jpeg" });
    const optimized = new File(["optimized"], "cover.jpg", { type: "image/jpeg" });
    const readBytes = vi.spyOn(optimized, "arrayBuffer");
    const commit = vi.fn();

    const result = await runCoverArtUploadTransaction(source, {
      optimize: async () => optimized,
      isCurrent: () => false,
      commit,
    });

    expect(result).toBeNull();
    expect(readBytes).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not commit cover bytes when the identity changes during the byte read", async () => {
    let resolveBytes!: (bytes: ArrayBuffer) => void;
    const bytes = new Promise<ArrayBuffer>((resolve) => {
      resolveBytes = resolve;
    });
    const optimized = new File(["optimized"], "cover.jpg", { type: "image/jpeg" });
    vi.spyOn(optimized, "arrayBuffer").mockReturnValue(bytes);
    let current = true;
    const commit = vi.fn();

    const transaction = runCoverArtUploadTransaction(optimized, {
      optimize: async () => optimized,
      isCurrent: () => current,
      commit,
    });
    await Promise.resolve();
    current = false;
    resolveBytes(Uint8Array.of(1, 2, 3).buffer);

    await expect(transaction).resolves.toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });
});
