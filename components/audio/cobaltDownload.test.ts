import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { downloadCobaltAudio } from "./cobaltDownload";

describe("downloadCobaltAudio", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("paces Cobalt tunnel download starts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let nextPlanId = 0;
    const tunnelStartTimes: number[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/cobalt/audio") {
          nextPlanId += 1;
          return Response.json({
            status: "tunnel",
            url: `/api/cobalt/tunnel?id=${nextPlanId}`,
            filename: `track-${nextPlanId}.mp3`,
          });
        }

        tunnelStartTimes.push(Date.now());
        return new Response("audio-bytes", {
          headers: {
            "Content-Type": "audio/mpeg",
          },
        });
      }),
    );

    const downloads = Promise.all(
      Array.from({ length: 4 }, (_value, index) =>
        downloadCobaltAudio({
          sourceUrl: `https://soundcloud.com/artist/track-${index}`,
          audioBitrate: "128",
        }),
      ),
    );

    await vi.advanceTimersByTimeAsync(7_000);
    await downloads;

    expect(tunnelStartTimes).toEqual([0, 1_600, 3_200, 4_800]);
  });

  it("reports Cobalt tunnel budget waits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    let nextPlanId = 0;
    const lifecycleEvents: Array<{ downloadIndex: number; time: number; type: string }> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/cobalt/audio") {
          nextPlanId += 1;
          return Response.json({
            status: "tunnel",
            url: `/api/cobalt/tunnel?id=${nextPlanId}`,
            filename: `track-${nextPlanId}.mp3`,
          });
        }

        return new Response("audio-bytes", {
          headers: {
            "Content-Type": "audio/mpeg",
          },
        });
      }),
    );

    const downloads = Promise.all(
      Array.from({ length: 2 }, (_value, downloadIndex) =>
        downloadCobaltAudio({
          sourceUrl: `https://soundcloud.com/artist/wait-${downloadIndex}`,
          audioBitrate: "128",
          onLifecycle: (event) => {
            lifecycleEvents.push({
              downloadIndex,
              time: Date.now(),
              type: event.type,
            });
          },
        }),
      ),
    );

    await vi.advanceTimersByTimeAsync(2_000);
    await downloads;

    expect(lifecycleEvents).toEqual([
      {
        downloadIndex: 1,
        time: 10_000,
        type: "tunnel-budget-wait-started",
      },
      {
        downloadIndex: 1,
        time: 11_600,
        type: "tunnel-budget-wait-ended",
      },
    ]);
  });

  it("fetches local-processing cover tunnels for track-specific artwork", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const fetchedUrls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetchedUrls.push(url);
        if (url === "/api/cobalt/audio") {
          return Response.json({
            status: "local-processing",
            type: "audio",
            service: "soundcloud",
            tunnel: ["/api/cobalt/tunnel?url=audio", "/api/cobalt/tunnel?url=cover"],
            output: {
              type: "audio/mpeg",
              filename: "track.mp3",
              metadata: {
                title: "Track",
              },
            },
            audio: {
              copy: false,
              format: "mp3",
              bitrate: "128",
            },
          });
        }

        return new Response("audio-bytes", {
          headers: {
            "Content-Type": "audio/mpeg",
          },
        });
      }),
    );

    const download = downloadCobaltAudio({
      sourceUrl: "https://soundcloud.com/artist/track",
      audioBitrate: "128",
    });
    const assertion = expect(download).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;

    expect(fetchedUrls).toEqual([
      "/api/cobalt/audio",
      "/api/cobalt/tunnel?url=audio",
      "/api/cobalt/tunnel?url=cover",
    ]);
  });
});
