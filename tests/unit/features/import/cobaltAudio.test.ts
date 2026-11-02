import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import { CobaltAudio, CobaltAudioLive } from "@/features/import/cobaltAudio";

const urlOf = (input: string | URL | Request) =>
  input instanceof Request ? input.url : input instanceof URL ? input.href : input;

const tunnelResponse = (outcome: string) =>
  outcome === "ready"
    ? new Response(new Uint8Array([1, 2, 3]), {
        headers: {
          "Content-Type": "audio/mpeg",
          "X-Tagium-Tunnel-Outcome": "ready",
          "X-Tagium-Tunnel-Attempts": "1",
        },
      })
    : new Response(
        outcome === "exhausted"
          ? "Cobalt tunnel response was empty."
          : "Cobalt tunnel request failed (429).",
        {
          status: 502,
          headers: {
            "X-Tagium-Tunnel-Outcome": outcome,
            "X-Tagium-Tunnel-Attempts": outcome === "exhausted" ? "7" : "1",
          },
        },
      );

const stubCobalt = (tunnelOutcomes: string[]) => {
  const outcomes = [...tunnelOutcomes];
  let plans = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      if (urlOf(input) === "/api/cobalt/audio") {
        plans += 1;

        return Response.json({
          status: "tunnel",
          url: `/api/cobalt/tunnel?plan=${plans}`,
          filename: "track.mp3",
        });
      }

      return tunnelResponse(outcomes.shift() ?? "ready");
    }),
  );

  return { plans: () => plans };
};

const download = async () => {
  const pending = Effect.runPromise(
    Effect.gen(function* () {
      const cobaltAudio = yield* CobaltAudio;

      return yield* cobaltAudio.download({
        sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        audioBitrate: "320",
        audioFormat: "mp3",
      });
    }).pipe(Effect.provide(CobaltAudioLive), Effect.result),
  );

  await vi.runAllTimersAsync();

  return pending;
};

describe("cobalt audio download", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves a fresh plan once when the tunnel comes back empty", async () => {
    vi.useFakeTimers();
    const cobalt = stubCobalt(["exhausted", "ready"]);

    const result = await download();

    expect(result._tag).toBe("Success");
    expect(cobalt.plans()).toBe(2);
  });

  it.each([
    { outcomes: ["exhausted", "exhausted"], plans: 2 },
    { outcomes: ["non_retryable"], plans: 1 },
  ])("fails after $plans plan(s) when tunnels return $outcomes", async ({ outcomes, plans }) => {
    vi.useFakeTimers();
    const cobalt = stubCobalt(outcomes);

    const result = await download();

    expect(result._tag).toBe("Failure");
    expect(cobalt.plans()).toBe(plans);
  });
});
