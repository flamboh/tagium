import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Effect, Layer } from "effect";
import {
  SOUNDCLOUD_MAX_CONCURRENT_DOWNLOADS,
  SoundCloudAudio,
  SoundCloudAudioLayer,
} from "@/features/import/soundcloudAudio";
import { LocalAudioProcessor } from "@/features/import/localAudioProcessor";
import {
  cobaltDownloadScheduler,
  resetCobaltDownloadSchedulerForTests,
} from "@/shared/cobalt/cobaltDownloadScheduler";

const deferred = () => {
  let resolve!: () => void;

  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
};

const urlOf = (input: string | URL | Request) =>
  input instanceof Request ? input.url : input instanceof URL ? input.href : input;

const stubSoundCloudStreams = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      if (urlOf(input) === "/api/soundcloud-stream") {
        return Response.json({
          initUrl: "https://cdn.test/init.mp4",
          segmentUrls: ["https://cdn.test/data000.m4s"],
          durationMs: 1_000,
          metadata: { title: "track" },
          coverUrl: null,
        });
      }

      return new Response(new Uint8Array([1]));
    }),
  );

const soundCloudAudioWith = (processAudio: () => Promise<void>) => {
  const processor = Layer.succeed(
    LocalAudioProcessor,
    LocalAudioProcessor.of({
      processAudio: ({ output }) =>
        Effect.promise(async () => {
          await processAudio();

          return new File([new Uint8Array([1])], output.filename, { type: output.type });
        }),
    }),
  );

  return Effect.runSync(
    Effect.gen(function* () {
      return yield* SoundCloudAudio;
    }).pipe(Effect.provide(SoundCloudAudioLayer.pipe(Layer.provide(processor)))),
  );
};

const download = (soundCloudAudio: SoundCloudAudio["Service"], index: number) =>
  Effect.runPromise(
    soundCloudAudio.download({
      sourceUrl: `https://soundcloud.com/artist/track-${index}`,
      audioBitrate: "320",
      audioFormat: "mp3",
    }),
  );

describe("soundcloud download slots", () => {
  beforeEach(() => {
    resetCobaltDownloadSchedulerForTests();
    stubSoundCloudStreams();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads soundcloud tracks while every cobalt slot is busy", async () => {
    const cobaltWork = deferred();

    const cobaltDownloads = Array.from({ length: 4 }, () =>
      cobaltDownloadScheduler.schedule(() => cobaltWork.promise),
    );

    const queuedCobaltWork = vi.fn(async () => undefined);
    const queuedCobaltDownload = cobaltDownloadScheduler.schedule(queuedCobaltWork);
    const soundCloudAudio = soundCloudAudioWith(async () => undefined);

    const file = await download(soundCloudAudio, 1);

    expect(file.name).toBe("track.mp3");
    expect(queuedCobaltWork).not.toHaveBeenCalled();

    cobaltWork.resolve();
    await Promise.all([...cobaltDownloads, queuedCobaltDownload]);
  });

  it("runs six soundcloud downloads at once without taking cobalt slots", async () => {
    const processing = deferred();
    let activeProcesses = 0;

    const soundCloudAudio = soundCloudAudioWith(async () => {
      activeProcesses += 1;
      await processing.promise;
    });

    const soundCloudDownloads = Array.from(
      { length: SOUNDCLOUD_MAX_CONCURRENT_DOWNLOADS + 1 },
      (_, index) => download(soundCloudAudio, index),
    );

    await vi.waitFor(() => expect(activeProcesses).toBe(SOUNDCLOUD_MAX_CONCURRENT_DOWNLOADS));
    expect(SOUNDCLOUD_MAX_CONCURRENT_DOWNLOADS).toBe(6);

    const cobaltDownloads = Array.from({ length: 4 }, (_, index) =>
      cobaltDownloadScheduler.schedule(async () => index),
    );

    await expect(Promise.all(cobaltDownloads)).resolves.toEqual([0, 1, 2, 3]);
    expect(activeProcesses).toBe(SOUNDCLOUD_MAX_CONCURRENT_DOWNLOADS);

    processing.resolve();
    await Promise.all(soundCloudDownloads);
    expect(activeProcesses).toBe(SOUNDCLOUD_MAX_CONCURRENT_DOWNLOADS + 1);
  });
});
