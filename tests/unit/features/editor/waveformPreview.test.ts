import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  MAX_WAVEFORM_SAMPLES,
  MAX_DECODED_PCM_BYTES,
  MAX_WAVEFORM_DECODE_BYTES,
  downsampleWaveform,
  estimateDecodedPcmBytes,
  formatPreviewTime,
  getSeekTime,
  loadWaveformPreview,
  normalizePreviewDuration,
} from "@/features/editor/waveformPreview";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("waveform preview", () => {
  it("formats bounded transport time", () => {
    expect(formatPreviewTime(0)).toBe("0:00");
    expect(formatPreviewTime(125.9)).toBe("2:05");
    expect(formatPreviewTime(-1)).toBe("0:00");
    expect(formatPreviewTime(Number.NaN)).toBe("0:00");
    expect(normalizePreviewDuration(Number.POSITIVE_INFINITY)).toBe(0);
    expect(normalizePreviewDuration(-10)).toBe(0);
  });

  it("maps pointer positions onto the track and clamps overflow", () => {
    expect(getSeekTime(150, 100, 200, 120)).toBe(30);
    expect(getSeekTime(50, 100, 200, 120)).toBe(0);
    expect(getSeekTime(400, 100, 200, 120)).toBe(120);
    expect(getSeekTime(150, 100, 0, 120)).toBe(0);
    expect(getSeekTime(150, 100, 200, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("downsamples every channel into a fixed, normalized peak envelope", () => {
    const channels = [
      new Float32Array([0, 0.25, 0.5, 0.25, 0, 0, 0, 0]),
      new Float32Array([0, 0, 0, 0, 0, -1, 0.5, 0]),
    ];
    const audio = {
      duration: 1,
      length: channels[0].length,
      numberOfChannels: channels.length,
      getChannelData: (index: number) => channels[index],
    };

    expect(downsampleWaveform(audio, 4)).toEqual([0.25, 0.5, 1, 0.5]);
    expect(downsampleWaveform(audio, MAX_WAVEFORM_SAMPLES + 100)).toHaveLength(
      MAX_WAVEFORM_SAMPLES,
    );
  });

  it("represents silent and empty audio without invalid values", () => {
    const silent = {
      duration: 0,
      length: 0,
      numberOfChannels: 0,
      getChannelData: () => new Float32Array(),
    };

    expect(downsampleWaveform(silent, 3)).toEqual([0, 0, 0]);
  });

  it("closes the decoding context after producing a bounded cached waveform", async () => {
    const close = vi.fn(async () => undefined);
    const decodeAudioData = vi.fn(async () => ({
      duration: 1,
      length: 2,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([0.5, 1]),
    }));
    class TestAudioContext {
      close = close;
      decodeAudioData = decodeAudioData;
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
    const file = new File(["audio"], "preview.mp3", { type: "audio/mpeg" });

    const first = await loadWaveformPreview(file, new AbortController().signal, 1);
    const second = await loadWaveformPreview(file, new AbortController().signal);

    expect(first.samples).toHaveLength(MAX_WAVEFORM_SAMPLES);
    expect(second).toBe(first);
    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not start decoding after its caller has canceled", async () => {
    const context = new AbortController();
    context.abort();

    await expect(
      loadWaveformPreview(new File(["audio"], "canceled.mp3"), context.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("never constructs a decoder without a finite positive duration", async () => {
    const construct = vi.fn();
    class TestAudioContext {
      constructor() {
        construct();
      }
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
    const file = new File(["audio"], "unknown-duration.mp3");

    await expect(loadWaveformPreview(file, new AbortController().signal, 0)).rejects.toThrow(
      "duration is required",
    );
    await expect(
      loadWaveformPreview(file, new AbortController().signal, Number.POSITIVE_INFINITY),
    ).rejects.toThrow("duration is required");
    expect(construct).not.toHaveBeenCalled();
  });

  it("rejects compressed-size and conservative duration budgets before decoding", async () => {
    const construct = vi.fn();
    class TestAudioContext {
      constructor() {
        construct();
      }
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
    const oversized = new File(["audio"], "oversized.mp3");
    Object.defineProperty(oversized, "size", { value: MAX_WAVEFORM_DECODE_BYTES + 1 });

    await expect(loadWaveformPreview(oversized, new AbortController().signal, 1)).rejects.toThrow(
      "too large",
    );

    const tooLong = MAX_DECODED_PCM_BYTES / estimateDecodedPcmBytes(1) + 1;
    await expect(
      loadWaveformPreview(new File(["audio"], "long.mp3"), new AbortController().signal, tooLong),
    ).rejects.toThrow("duration exceeds");
    expect(construct).not.toHaveBeenCalled();
  });

  it("rejects decoded PCM above budget and still closes its context", async () => {
    const close = vi.fn(async () => undefined);
    class TestAudioContext {
      close = close;
      async decodeAudioData() {
        return {
          duration: 1,
          length: MAX_DECODED_PCM_BYTES / Float32Array.BYTES_PER_ELEMENT + 1,
          numberOfChannels: 1,
          getChannelData: vi.fn(),
        };
      }
    }
    vi.stubGlobal("AudioContext", TestAudioContext);

    await expect(
      loadWaveformPreview(
        new File(["audio"], "decoded-large.mp3"),
        new AbortController().signal,
        1,
      ),
    ).rejects.toThrow("decoded audio exceeds");
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes and discards a decode that is canceled in flight", async () => {
    let resolveDecode!: (audio: {
      duration: number;
      length: number;
      numberOfChannels: number;
      getChannelData: () => Float32Array;
    }) => void;
    const close = vi.fn(async () => undefined);
    class TestAudioContext {
      close = close;
      decodeAudioData = vi.fn(
        () =>
          new Promise<{
            duration: number;
            length: number;
            numberOfChannels: number;
            getChannelData: () => Float32Array;
          }>((resolve) => {
            resolveDecode = resolve;
          }),
      );
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
    const controller = new AbortController();
    const loading = loadWaveformPreview(
      new File(["audio"], "cancel-running.mp3"),
      controller.signal,
      1,
    );
    await vi.waitFor(() => expect(resolveDecode).toBeTypeOf("function"));
    controller.abort();
    resolveDecode({
      duration: 1,
      length: 1,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array([1]),
    });

    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("serializes decode contexts and skips canceled queued work", async () => {
    const resolvers: Array<() => void> = [];
    let activeContexts = 0;
    let maximumActiveContexts = 0;
    const constructed = vi.fn();
    class TestAudioContext {
      constructor() {
        constructed();
        activeContexts += 1;
        maximumActiveContexts = Math.max(maximumActiveContexts, activeContexts);
      }

      async decodeAudioData() {
        await new Promise<void>((resolve) => resolvers.push(resolve));
        return {
          duration: 1,
          length: 1,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([1]),
        };
      }

      async close() {
        activeContexts -= 1;
      }
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
    const first = loadWaveformPreview(
      new File(["first"], "first-queued.mp3"),
      new AbortController().signal,
      1,
    );
    const canceledController = new AbortController();
    const canceledQueued = loadWaveformPreview(
      new File(["second"], "second-queued.mp3"),
      canceledController.signal,
      1,
    );
    const third = loadWaveformPreview(
      new File(["third"], "third-queued.mp3"),
      new AbortController().signal,
      1,
    );
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    canceledController.abort();
    resolvers.shift()?.();
    await first;
    await expect(canceledQueued).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    resolvers.shift()?.();
    await third;

    expect(constructed).toHaveBeenCalledTimes(2);
    expect(maximumActiveContexts).toBe(1);
  });
});
