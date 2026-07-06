import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runAudioEffectWithoutServices } from "./audioRuntime";
import { decodeCobaltDownloadPlanEffect } from "./cobaltAudioSchemas";
import {
  applyCobaltAudioMetadata,
  downloadCobaltAudio,
  validateLocalAudioPlan,
} from "./cobaltDownload";
import type { CobaltDownloadPlan } from "./cobaltDownload";

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

const mp3tagMock = vi.hoisted(() => ({
  instances: [] as FakeMP3TagInstance[],
}));

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

describe("downloadCobaltAudio", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    mp3tagMock.instances = [];
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

    await downloadCobaltAudio({
      sourceUrl: "https://soundcloud.com/artist/prime",
      audioBitrate: "128",
    });

    const delayedDownload = downloadCobaltAudio({
      sourceUrl: "https://soundcloud.com/artist/delayed",
      audioBitrate: "128",
    });
    await vi.advanceTimersByTimeAsync(0);

    const controller = new AbortController();
    const abortedDownload = downloadCobaltAudio({
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

    await expect(
      downloadCobaltAudio({
        sourceUrl: "https://soundcloud.com/artist/malformed",
        audioBitrate: "128",
      }),
    ).rejects.toThrow();
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

  it("ignores unknown local worker messages until a valid result arrives", async () => {
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
                  progress: 0.5,
                },
              },
            } as MessageEvent);
            this.onmessage?.({
              data: {
                cobaltLocalProcessing: {
                  blob: new Blob(["processed-audio"], { type: "audio/mp4" }),
                },
              },
            } as MessageEvent);
          });
        }

        terminate() {}
      },
    );

    const file = await downloadCobaltAudio({
      sourceUrl: "https://soundcloud.com/artist/track",
      audioBitrate: "128",
    });

    expect(file.name).toBe("track.m4a");
    expect(new TextDecoder().decode(await file.arrayBuffer())).toBe("processed-audio");
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
      downloadCobaltAudio({
        sourceUrl: "https://soundcloud.com/artist/track",
        audioBitrate: "128",
      }),
    ).rejects.toThrow("malformed Cobalt local processing message.");
  });

  it("processes local audio with cover art through the worker and mp3tag", async () => {
    const fetchedUrls: string[] = [];
    const workerMessages: unknown[] = [];

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

        postMessage(message: unknown) {
          workerMessages.push(message);
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                cobaltLocalProcessing: {
                  blob: new Blob(["processed-audio"], { type: "audio/mpeg" }),
                },
              },
            } as MessageEvent);
          });
        }

        terminate() {}
      },
    );

    const file = await downloadCobaltAudio({
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
    expect(
      (workerMessages[0] as { cobaltLocalProcessing: { audioFile: File } }).cobaltLocalProcessing
        .audioFile,
    ).toMatchObject({
      name: "input-0",
      type: "audio/mpeg",
    });
    expect(mp3tagMock.instances[0]?.tags).toMatchObject({
      title: "Track",
      v2: {
        APIC: [
          {
            format: "image/jpeg",
            type: 3,
            description: "cover",
            data: Array.from(new TextEncoder().encode("audio-bytes")),
          },
        ],
      },
    });
    expect(file).toMatchObject({
      name: "Track.MP3",
      type: "audio/mpeg",
    });
    expect(new TextDecoder().decode(await file.arrayBuffer())).toBe("saved-audio");
  });

  it("returns non-mp3 local audio without fetching cover or using mp3tag", async () => {
    const fetchedUrls: string[] = [];
    const workerMessages: unknown[] = [];

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
              type: "audio/mp4",
              filename: "track.m4a",
              metadata: {
                title: "Track",
              },
            },
            audio: {
              copy: false,
              format: "m4a",
              bitrate: "256",
            },
          });
        }

        if (url === "/api/cobalt/tunnel?url=cover") {
          return new Response("", { status: 500 });
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

        postMessage(message: unknown) {
          workerMessages.push(message);
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                cobaltLocalProcessing: {
                  blob: new Blob(["processed-audio"], { type: "audio/mp4" }),
                },
              },
            } as MessageEvent);
          });
        }

        terminate() {}
      },
    );

    const file = await downloadCobaltAudio({
      sourceUrl: "https://soundcloud.com/artist/track",
      audioBitrate: "256",
    });

    expect(fetchedUrls).toEqual(["/api/cobalt/audio", "/api/cobalt/tunnel?url=audio"]);
    expect(workerMessages[0]).toMatchObject({
      cobaltLocalProcessing: {
        audio: {
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

  it("accepts Cobalt cropCover as an advisory cover hint", () => {
    expect(() =>
      validateLocalAudioPlan(
        localAudioPlan({
          tunnel: ["https://example.com/audio", "https://example.com/cover"],
          audio: {
            copy: false,
            format: "mp3",
            bitrate: "128",
            cover: true,
            cropCover: true,
          },
        }),
      ),
    ).not.toThrow();
  });

  it("treats a second local-processing tunnel as cover art", () => {
    expect(() =>
      validateLocalAudioPlan(
        localAudioPlan({
          tunnel: ["https://example.com/audio", "https://example.com/cover"],
        }),
      ),
    ).not.toThrow();
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
