import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { downloadFromCobalt, runAudioBackendEffect } from "@/features/audio/audioBackend";
import type { CobaltAudioDownloadRequest } from "@/features/import/cobaltAudio";
import { ImportStageError } from "@/features/import/importLifecycle";
import type { CobaltDownloadPlan } from "@/features/import/cobaltAudioSchemas";
import { validateLocalAudioPlan } from "@/features/import/localAudioProcessor";

const runCobaltDownload = (
  request: Omit<CobaltAudioDownloadRequest, "audioFormat"> &
    Partial<Pick<CobaltAudioDownloadRequest, "audioFormat">>,
) => runAudioBackendEffect(downloadFromCobalt({ audioFormat: "mp3", ...request }));

interface FakeMP3TagInstance {
  buffer?: ArrayBuffer;
  error?: string;
  tags: {
    title?: string;
    v2?: {
      APIC?: Array<{
        format: string;
        type: number;
        description: string;
        data: number[];
      }>;
    };
  };
  read: () => void;
  save: () => void;
}

const mp3tagMock = vi.hoisted(() => {
  const instances: FakeMP3TagInstance[] = [];
  return { instances };
});

vi.mock("mp3tag.js", () => ({
  default: class FakeMP3Tag implements FakeMP3TagInstance {
    buffer?: ArrayBuffer;
    tags = {};

    constructor(_buffer: ArrayBuffer) {
      mp3tagMock.instances.push(this);
    }

    read() {}

    save() {
      this.buffer = new TextEncoder().encode("saved-audio").buffer;
    }
  },
}));

type LocalAudioPlan = Extract<CobaltDownloadPlan, { status: "local-processing" }>;
const localAudioPlan = (overrides: Partial<LocalAudioPlan> = {}): LocalAudioPlan => ({
  status: "local-processing",
  type: "audio",
  tunnel: ["https://example.com/audio"],
  output: {
    type: "audio/mpeg",
    filename: "track.mp3",
  },
  audio: {
    copy: false,
    format: "mp3",
    bitrate: "128",
  },
  ...overrides,
});

describe("CobaltAudio download", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    mp3tagMock.instances = [];
  });

  it.each([
    {
      outcome: "recovered",
      attempts: "3",
      status: 200,
      expectedError: undefined,
    },
    {
      outcome: "exhausted",
      attempts: "7",
      status: 502,
      expectedError: "Cobalt tunnel response was empty.",
    },
    {
      outcome: "non_retryable",
      attempts: "1",
      status: 502,
      expectedError: "Cobalt tunnel request timed out.",
    },
    {
      outcome: "non_retryable",
      attempts: "2",
      status: 502,
      expectedError: "upstream fetch failed.",
    },
  ] as const)(
    "reports $outcome tunnel readiness without tunnel details",
    async ({ outcome, attempts, status, expectedError }) => {
      const onLifecycle = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url === "/api/cobalt/audio") {
            return Response.json({
              status: "tunnel",
              url: "/api/cobalt/tunnel?private=signature",
              filename: "private-title.mp3",
            });
          }

          return new Response(status === 200 ? "audio-bytes" : expectedError, {
            status,
            headers: {
              "Content-Type": "audio/mpeg",
              "X-Tagium-Tunnel-Outcome": outcome,
              "X-Tagium-Tunnel-Attempts": attempts,
            },
          });
        }),
      );

      const download = runCobaltDownload({
        sourceUrl: "https://soundcloud.com/private-artist/private-track",
        audioBitrate: "128",
        onLifecycle,
      });

      if (expectedError) {
        const error = await download.then(
          () => undefined,
          (cause: unknown) => cause,
        );
        expect(error).toBeInstanceOf(ImportStageError);
        expect(error).toMatchObject({ stage: "tunnel", message: expectedError });
      } else {
        await download;
      }

      expect(onLifecycle).toHaveBeenCalledWith({
        type: "tunnel-readiness",
        outcome,
        attempts: Number(attempts),
        elapsedBucket: "under_1_second",
      });
      expect(JSON.stringify(onLifecycle.mock.calls)).not.toContain("private");
      expect(JSON.stringify(onLifecycle.mock.calls)).not.toContain("signature");
    },
  );

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
        runCobaltDownload({
          sourceUrl: `https://soundcloud.com/artist/track-${index}`,
          audioBitrate: "128",
        }),
      ),
    );

    await vi.advanceTimersByTimeAsync(7_000);
    await downloads;

    const firstStart = tunnelStartTimes[0] ?? 0;
    expect(tunnelStartTimes.map((time) => time - firstStart)).toEqual([0, 1_600, 3_200, 4_800]);
  });

  it("rejects promptly when aborted behind the tunnel pacing queue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(20_000);
    let nextPlanId = 0;

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

    await runCobaltDownload({
      sourceUrl: "https://soundcloud.com/artist/prime",
      audioBitrate: "128",
    });

    const delayedDownload = runCobaltDownload({
      sourceUrl: "https://soundcloud.com/artist/delayed",
      audioBitrate: "128",
    });
    await vi.advanceTimersByTimeAsync(0);

    const controller = new AbortController();
    const abortedDownload = runCobaltDownload({
      sourceUrl: "https://soundcloud.com/artist/aborted",
      audioBitrate: "128",
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(0);

    controller.abort(new Error("cancelled"));
    const abortedStatus = await Promise.race([
      abortedDownload.then(
        () => "resolved",
        (error: Error) => error.message,
      ),
      vi.advanceTimersByTimeAsync(10).then(() => "pending"),
    ]);

    expect(abortedStatus).toBe("cancelled");

    await vi.advanceTimersByTimeAsync(2_000);
    await delayedDownload;
  });

  it("rejects malformed Cobalt audio plans before tunnel fetch", async () => {
    const fetchedUrls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetchedUrls.push(url);
        return Response.json({
          status: "tunnel",
          url: 123,
          filename: "track.mp3",
        });
      }),
    );

    const error = await runCobaltDownload({
      sourceUrl: "https://soundcloud.com/artist/malformed",
      audioBitrate: "128",
    }).then(
      () => undefined,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(ImportStageError);
    expect(error).toMatchObject({ stage: "plan" });
    expect(fetchedUrls).toEqual(["/api/cobalt/audio"]);
  });

  it("rejects malformed terminal local worker messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "/api/cobalt/audio") {
          return Response.json({
            status: "local-processing",
            type: "audio",
            tunnel: ["/api/cobalt/tunnel?url=audio"],
            output: {
              type: "audio/mp4",
              filename: "track.m4a",
            },
            audio: {
              copy: false,
              format: "m4a",
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
    vi.stubGlobal(
      "Worker",
      class FakeWorker {
        onmessage?: (event: MessageEvent) => void;

        postMessage() {
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                cobaltLocalProcessing: {
                  error: 500,
                },
              },
            } as MessageEvent);
          });
        }

        terminate() {}
      },
    );

    await expect(
      runCobaltDownload({
        sourceUrl: "https://soundcloud.com/artist/track",
        audioBitrate: "128",
      }),
    ).rejects.toThrow("malformed cobalt local processing message.");
  });

  it("validates declared cover tunnel shape", () => {
    expect(() =>
      validateLocalAudioPlan(
        localAudioPlan({
          audio: {
            copy: false,
            format: "mp3",
            bitrate: "128",
            cover: true,
          },
        }),
      ),
    ).toThrow("cobalt local processing response missing cover tunnel.");
  });
});
