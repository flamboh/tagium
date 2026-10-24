import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createYouTubeResolver } from "../../cobalt-youtube/scheduler.mjs";

describe("shared YouTube resolve budget", () => {
  afterEach(() => vi.useRealTimers());

  it("paces different users and rejects overflow without resolving it", async () => {
    vi.useFakeTimers();
    const starts = [];

    const resolve = createYouTubeResolver(async ({ id }) => {
      starts.push({ id, at: Date.now() });

      return { urls: id };
    });

    const requests = Array.from({ length: 5 }, (_, id) => resolve({ id }));
    await vi.advanceTimersByTimeAsync(15_000);
    const results = await Promise.all(requests);
    expect(starts.map(({ id }) => id)).toEqual([0, 1, 2, 3]);
    expect(starts.slice(1).map(({ at }, index) => at - starts[index].at)).toEqual([
      5_000, 5_000, 5_000,
    ]);
    expect(results[4]).toEqual({ error: "capacity_exceeded" });
  });

  it.each(["youtube.login", "fetch.rate", "thrown 429"])(
    "opens the circuit on %s, including already queued users, then allows one probe",
    async (failure) => {
      vi.useFakeTimers();
      const error = failure === "thrown 429" ? "fetch.rate" : failure;

      const upstream = vi.fn(async () => {
        if (failure === "thrown 429") throw Object.assign(new Error(), { code: "fetch.rate" });

        return { error, retry: true };
      });

      const resolve = createYouTubeResolver(upstream);
      const requests = [resolve({}), resolve({}), resolve({})];
      await vi.advanceTimersByTimeAsync(0);
      expect(await Promise.all(requests)).toEqual(Array(3).fill({ error }));
      expect(await resolve({})).toEqual({ error });
      expect(upstream).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(await resolve({})).toEqual({ error });
      expect(upstream).toHaveBeenCalledTimes(2);
    },
  );

  it("suppresses retries of rejected media while another track can still resolve", async () => {
    vi.useFakeTimers();

    const upstream = vi.fn(async ({ id }) =>
      id === "blocked" ? { error: "fetch.fail", cooldown: "video" } : { urls: "audio" },
    );

    const resolve = createYouTubeResolver(upstream);
    const failed = resolve({ id: "blocked" });
    const duplicate = resolve({ id: "blocked" });
    const other = resolve({ id: "working" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await failed).toEqual({ error: "fetch.fail" });
    expect(await duplicate).toEqual({ error: "fetch.fail" });
    expect(await other).toEqual({ urls: "audio" });
    expect(upstream).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(295_000);
    expect(await resolve({ id: "blocked" })).toEqual({ error: "fetch.fail" });
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("makes at most two spaced transient attempts and never retries content errors", async () => {
    vi.useFakeTimers();
    const upstream = vi.fn(async () => ({ error: "fetch.fail", retry: true }));
    const resolve = createYouTubeResolver(upstream);
    const result = resolve({});
    await vi.advanceTimersByTimeAsync(4_999);
    expect(upstream).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ error: "fetch.fail" });
    expect(upstream).toHaveBeenCalledTimes(2);
    upstream.mockResolvedValue({ error: "content.video.private", retry: true });
    const privateResult = resolve({});
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await privateResult).toEqual({ error: "content.video.private" });
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("aborts a stalled attempt and expires queued work before it can contact YouTube", async () => {
    vi.useFakeTimers();
    const signals = [];

    const resolve = createYouTubeResolver(
      ({ signal }) => {
        signals.push(signal);

        return new Promise(() => {});
      },
      { attemptTimeoutMs: 10_000, queueTimeoutMs: 8_000 },
    );

    const stalled = resolve({});
    const queued = resolve({});
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await queued).toEqual({ error: "capacity_exceeded" });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(await stalled).toEqual({ error: "fetch.fail" });
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
