import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { downloadFromCobalt, runAudioBackendEffect } from "@/features/audio/audioBackend";
import { runAudioEffectWithoutServices } from "@/features/audio/audioRuntime";
import type { CobaltAudioDownloadRequest } from "@/features/import/cobaltAudio";
import { ImportStageError } from "@/features/import/importLifecycle";
import type { CobaltDownloadPlan } from "@/features/import/cobaltAudioSchemas";
import { decodeCobaltDownloadPlanEffect } from "@/features/import/cobaltAudioSchemas";
import {
  applyCobaltAudioMetadata,
  validateLocalAudioPlan,
} from "@/features/import/localAudioProcessor";
import { inspectAudioFile } from "@/features/audio/metadataEngine/engine";
import { validMp3Bytes } from "../../support/mp3TestFixtures";
import { validM4aBytes } from "../../support/m4aTestFixtures";

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
type LocalProcessingWorkerRequest = {
  cobaltLocalProcessing: {
    audioFile: File;
    audio: { copy: boolean; format: string; bitrate: string };
    output: {
      type: string;
      format: string;
      metadata?: Record<string, string | undefined>;
    };
  };
};

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

  it("decodes Cobalt audio plans from the schema-derived Effect decoder", async () => {
    const plan = await runAudioEffectWithoutServices(
      decodeCobaltDownloadPlanEffect({
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
      }),
    );

    expect(plan).toMatchObject({
      status: "local-processing",
      output: {
        filename: "track.m4a",
      },
    });
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

  it("processes local audio with cover art through the bounded metadata engine", async () => {
    const fetchedUrls: string[] = [];
    const workerMessages: LocalProcessingWorkerRequest[] = [];

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
              filename: "Track.MP3",
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
            "Content-Type": url.endsWith("cover") ? "image/jpeg" : "audio/mpeg",
          },
        });
      }),
    );
    vi.stubGlobal(
      "Worker",
      class FakeWorker {
        onmessage?: (event: MessageEvent) => void;
        onerror?: (event: ErrorEvent) => void;

        postMessage(message: LocalProcessingWorkerRequest) {
          workerMessages.push(message);
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                cobaltLocalProcessing: {
                  progress: 0.5,
                },
              },
            } as MessageEvent);
            this.onmessage?.({
              data: {
                cobaltLocalProcessing: {
                  blob: new Blob([validMp3Bytes()], { type: "audio/mpeg" }),
                },
              },
            } as MessageEvent);
          });
        }

        terminate() {}
      },
    );

    const file = await runCobaltDownload({
      sourceUrl: "https://soundcloud.com/artist/track",
      audioBitrate: "128",
    });

    expect(fetchedUrls).toEqual([
      "/api/cobalt/audio",
      "/api/cobalt/tunnel?url=audio",
      "/api/cobalt/tunnel?url=cover",
    ]);
    expect(workerMessages).toHaveLength(1);
    expect(workerMessages[0]).toMatchObject({
      cobaltLocalProcessing: {
        audio: {
          copy: false,
          format: "mp3",
          bitrate: "128",
        },
        output: {
          type: "audio/mpeg",
          format: "mp3",
          metadata: {
            title: "Track",
          },
        },
      },
    });
    expect(workerMessages[0]?.cobaltLocalProcessing.audioFile).toMatchObject({
      name: "input-0",
      type: "audio/mpeg",
    });
    expect(file).toMatchObject({
      name: "Track.MP3",
      type: "audio/mpeg",
    });
    const inspected = await Effect.runPromise(inspectAudioFile(file));
    expect(inspected.metadata.title).toBe("Track");
    expect(inspected.metadata.picture[0]).toMatchObject({
      format: "image/jpeg",
      type: 3,
      description: "cover",
    });
    expect(inspected.metadata.picture[0]?.data).toEqual(new TextEncoder().encode("audio-bytes"));
  });

  it("preserves and tags compatible m4a audio from a Cobalt proxy plan", async () => {
    const fetchedUrls: string[] = [];
    const workerMessages: LocalProcessingWorkerRequest[] = [];
    const m4aBytes = await validM4aBytes();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetchedUrls.push(url);
        if (url === "/api/cobalt/audio") {
          return Response.json({
            status: "local-processing",
            type: "proxy",
            service: "youtube",
            tunnel: ["/api/cobalt/tunnel?url=audio", "/api/cobalt/tunnel?url=cover"],
            output: {
              type: "audio/mp4",
              filename: "track.m4a",
              metadata: {
                title: "Track",
                copyright: "not supported by the m4a metadata driver",
              },
            },
            audio: {
              copy: false,
              format: "m4a",
              bitrate: "256",
              cover: true,
            },
          });
        }

        return new Response("audio-bytes", {
          headers: {
            "Content-Type": url.endsWith("cover") ? "image/jpeg" : "audio/mp4",
          },
        });
      }),
    );
    vi.stubGlobal(
      "Worker",
      class FakeWorker {
        onmessage?: (event: MessageEvent) => void;

        postMessage(message: LocalProcessingWorkerRequest) {
          workerMessages.push(message);
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                cobaltLocalProcessing: {
                  blob: new Blob([m4aBytes], { type: "audio/mp4" }),
                },
              },
            } as MessageEvent);
          });
        }

        terminate() {}
      },
    );

    const file = await runCobaltDownload({
      sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      audioBitrate: "256",
      audioFormat: "best",
    });

    expect(fetchedUrls).toEqual([
      "/api/cobalt/audio",
      "/api/cobalt/tunnel?url=audio",
      "/api/cobalt/tunnel?url=cover",
    ]);
    expect(workerMessages[0]).toMatchObject({
      cobaltLocalProcessing: {
        audio: {
          copy: true,
          format: "m4a",
          bitrate: "256",
        },
        output: {
          type: "audio/mp4",
          format: "m4a",
          metadata: {
            title: "Track",
          },
        },
      },
    });
    expect(file).toMatchObject({
      name: "track.m4a",
      type: "audio/mp4",
    });
    const inspected = await Effect.runPromise(inspectAudioFile(file));
    expect(inspected.metadata.title).toBe("Track");
    expect(inspected.metadata.picture[0]).toMatchObject({
      format: "image/jpeg",
      type: 3,
      description: "",
    });
    expect(mp3tagMock.instances).toEqual([]);
  });

  it("applies Cobalt audio metadata through mp3tag frames", () => {
    const mp3tag = { tags: {} };

    applyCobaltAudioMetadata(mp3tag, {
      title: "Ti\u0007t\nle",
      artist: "Artist",
      album: "Album",
      date: "2026",
      genre: "Genre",
      track: "2",
      album_artist: "Album Artist",
      composer: "Composer",
      copyright: "Copyright",
      sublanguage: "en\u001bg",
    });

    expect(mp3tag.tags).toEqual({
      title: "Title",
      artist: "Artist",
      album: "Album",
      year: "2026",
      genre: "Genre",
      track: "2",
      v2: {
        TPE2: "Album Artist",
        TCOM: "Composer",
        TCOP: "Copyright",
        TLAN: "eng",
      },
    });
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
