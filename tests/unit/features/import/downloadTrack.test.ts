import { describe, expect, it, vi } from "vite-plus/test";
import { MAX_COVER_ART_UPLOAD_BYTES } from "@/features/editor/coverArtProcessing";
import { fetchImportedCover } from "@/features/import/downloadTrack";

const streamedResponse = (chunks: Uint8Array[], contentType: string) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    { headers: { "content-type": contentType } },
  );

describe("imported cover downloads", () => {
  it("rejects a streamed body that exceeds the cover limit without trusting content-length", async () => {
    const response = streamedResponse(
      [new Uint8Array(MAX_COVER_ART_UPLOAD_BYTES), Uint8Array.of(1)],
      "image/jpeg",
    );
    const fetch = vi.fn(async () => response);
    const optimize = vi.fn(async (file: File) => file);

    await expect(
      fetchImportedCover("https://example.com/cover", { fetch, optimize }),
    ).rejects.toThrow("25 mb");
    expect(optimize).not.toHaveBeenCalled();
  });

  it("rejects unsupported remote cover types before reading their bodies", async () => {
    const response = streamedResponse([Uint8Array.of(1, 2, 3)], "image/webp");
    const readBody = vi.spyOn(response.body!, "getReader");

    await expect(
      fetchImportedCover("https://example.com/cover", { fetch: async () => response }),
    ).rejects.toThrow("jpeg or png");
    expect(readBody).not.toHaveBeenCalled();
  });
});
