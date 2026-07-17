import { describe, expect, it, vi } from "vite-plus/test";
import { MAX_COVER_ART_UPLOAD_BYTES } from "@/features/editor/coverArtProcessing";
import { createSingleUrlDownloadPlan, fetchImportedCover } from "@/features/import/downloadTrack";

describe("single URL download plans", () => {
  it("seeds pending tracks with metadata resolved before download", () => {
    const plan = createSingleUrlDownloadPlan({
      sourceUrl: "https://youtube.com/watch?v=abcdefghijk",
      audioBitrate: "320",
      createId: () => "track-1",
      metadata: {
        title: "Burial - Archangel (Official Audio)",
        artist: "Burial",
        coverUrl: "https://example.com/cover.jpg",
      },
    });

    expect(plan.pendingFiles[0]).toMatchObject({
      filename: "Burial - Archangel (Official Audio).mp3",
      downloadStatus: "downloading",
      metadata: {
        title: "Burial - Archangel (Official Audio)",
        artist: "Burial",
      },
    });
    expect(plan.queuedTracks[0]?.title).toBe("Burial - Archangel (Official Audio)");
  });
});

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
    ).rejects.toThrow("25 MB");
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

  it("normalizes a bounded remote cover through the shared optimizer", async () => {
    const response = streamedResponse([Uint8Array.of(10, 20), Uint8Array.of(30)], "image/jpg; q=1");
    const wholeBodyRead = vi
      .spyOn(response, "arrayBuffer")
      .mockRejectedValue(new Error("whole-body read is forbidden"));
    const optimize = vi.fn(async (file: File) => {
      expect(file.type).toBe("image/jpeg");
      expect(file.size).toBe(3);
      return new File([Uint8Array.of(4, 5)], "cover.png", { type: "image/png" });
    });

    const picture = await fetchImportedCover("https://example.com/cover", {
      fetch: async () => response,
      optimize,
    });

    expect(optimize).toHaveBeenCalledOnce();
    expect(picture).toEqual([
      {
        format: "image/png",
        type: 3,
        data: Uint8Array.of(4, 5),
        description: "album cover",
      },
    ]);
    expect(wholeBodyRead).not.toHaveBeenCalled();
  });
});
