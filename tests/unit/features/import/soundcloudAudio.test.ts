import { describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import {
  downloadStreamParts,
  soundCloudOutputMetadata,
  type SoundCloudStream,
} from "@/features/import/soundcloudAudio";

const bytes = (...values: number[]) => new Uint8Array(values);

const succeed = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const fail = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect));

const urlOf = (input: string | URL | Request) =>
  input instanceof Request ? input.url : input instanceof URL ? input.href : input;

describe("soundcloud stream part download", () => {
  it("keeps parts in playlist order while fetching them concurrently and reports progress", async () => {
    const delays = new Map([
      ["init", 30],
      ["a", 0],
      ["b", 15],
    ]);

    let active = 0;
    let peak = 0;
    const progress: number[] = [];

    const fetch = vi.fn(async (input: string | URL | Request) => {
      const name = urlOf(input);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delays.get(name)));
      active -= 1;

      return new Response(bytes(name.charCodeAt(0)));
    });

    const parts = await succeed(
      downloadStreamParts({
        urls: ["init", "a", "b"],
        concurrency: 2,
        fetch,
        onProgress: ({ completed, total }) => progress.push(completed / total),
      }),
    );

    expect(parts).toEqual([bytes(105), bytes(97), bytes(98)]);
    expect(peak).toBe(2);
    expect(progress).toEqual([1 / 3, 2 / 3, 1]);
  });

  it("retries server errors, network failures and empty bodies", async () => {
    const responses = [
      () => new Response(null, { status: 503 }),
      () => Promise.reject(new TypeError("failed to fetch")),
      () => new Response(new Uint8Array()),
      () => new Response(bytes(1, 2)),
    ];

    const fetch = vi.fn(async () => responses.shift()!());

    const parts = await succeed(
      downloadStreamParts({ urls: ["seg"], retries: 3, retryDelayMs: 1, fetch }),
    );

    expect(parts).toEqual([bytes(1, 2)]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("does not retry expired or forbidden segment urls", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 403 }));

    const error = await fail(
      downloadStreamParts({ urls: ["seg"], retries: 3, retryDelayMs: 1, fetch }),
    );

    expect(error.status).toBe(403);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retry budget", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 500 }));

    const error = await fail(
      downloadStreamParts({ urls: ["seg"], retries: 2, retryDelayMs: 1, fetch }),
    );

    expect(error.status).toBe(500);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("stops fetching and retrying once the download is aborted", async () => {
    const controller = new AbortController();

    const fetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
          controller.abort();
        }),
    );

    const error = await fail(
      downloadStreamParts({
        urls: ["a", "b", "c"],
        concurrency: 1,
        retries: 3,
        retryDelayMs: 1,
        signal: controller.signal,
        fetch,
      }),
    );

    expect(error.cause).toBeInstanceOf(DOMException);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("soundcloud output metadata", () => {
  const stream: SoundCloudStream = {
    initUrl: "init",
    segmentUrls: ["seg"],
    durationMs: 1000,
    metadata: { title: "Introitus", date: "2012-04-02" },
    coverUrl: null,
  };

  it("keeps the provider date without a requested year", () => {
    expect(soundCloudOutputMetadata(stream, {})).toEqual(stream.metadata);
  });

  it("prefers the track year, then the playlist fallback year", () => {
    expect(soundCloudOutputMetadata(stream, { year: 2013, fallbackYear: 2010 }).date).toBe("2013");
    expect(soundCloudOutputMetadata(stream, { fallbackYear: 2010 }).date).toBe("2010");
  });
});
