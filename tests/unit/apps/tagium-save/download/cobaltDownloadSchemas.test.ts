import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import {
  cobaltVideoQualities,
  decodeCobaltDownloadPlanEffect,
  decodeCobaltDownloadResponseEffect,
  makeCobaltVideoDownloadRequestBody,
} from "@/apps/tagium-save/download/cobaltDownloadSchemas";

describe("cobalt video download schemas", () => {
  it("only advertises qualities accepted by the Tagium endpoint", () => {
    expect(cobaltVideoQualities).toEqual(["1080", "720", "480", "360", "240", "144"]);
  });

  it("accepts picker, tunnel, and local-processing plans", async () => {
    const plans = [
      {
        status: "tunnel",
        url: "/api/cobalt/tunnel?id=video",
        filename: "clip.mp4",
      },
      {
        status: "picker",
        picker: [
          {
            type: "video",
            url: "https://cdn.example/clip.mp4",
            thumb: "https://cdn.example/thumb.jpg",
          },
        ],
      },
      {
        status: "local-processing",
        type: "merge",
        service: "youtube",
        tunnel: ["/api/cobalt/tunnel?id=video", "/api/cobalt/tunnel?id=audio"],
        output: { type: "video/mp4", filename: "clip.mp4" },
      },
    ] as const;

    for (const plan of plans) {
      await expect(Effect.runPromise(decodeCobaltDownloadPlanEffect(plan))).resolves.toEqual(plan);
    }
  });

  it("rejects malformed plans instead of widening unknown response data", async () => {
    await expect(
      Effect.runPromise(
        decodeCobaltDownloadResponseEffect({
          status: "local-processing",
          type: "merge",
          tunnel: [123],
          output: { type: "video/mp4", filename: "clip.mp4" },
        }),
      ),
    ).rejects.toBeDefined();
  });

  it("builds a forced-local-processing request with Cobalt defaults", () => {
    expect(
      makeCobaltVideoDownloadRequestBody({
        sourceUrl: "https://youtube.com/watch?v=example",
        videoQuality: "720",
        youtubeVideoContainer: "mp4",
      }),
    ).toEqual({
      url: "https://youtube.com/watch?v=example",
      audioBitrate: "128",
      audioFormat: "best",
      downloadMode: "auto",
      filenameStyle: "pretty",
      youtubeVideoCodec: "h264",
      youtubeVideoContainer: "mp4",
      videoQuality: "720",
      localProcessing: "forced",
      alwaysProxy: true,
    });
  });
});
