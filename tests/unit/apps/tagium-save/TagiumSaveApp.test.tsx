import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AnalyticsEvent } from "@/analytics";
import TagiumSaveApp from "@/apps/tagium-save/TagiumSaveApp";
import {
  presentVideoDownloadFailure,
  updateVideoDownloadSettings,
  type VideoDownloadSettings,
} from "@/apps/tagium-save/tagiumSaveModel";
import {
  VideoDownloadError,
  type VideoDownloadResult,
  type VideoDownloadTask,
  type VideoFileDownloadResult,
  type VideoPickerDownloadResult,
} from "@/apps/tagium-save/download";
import { resetSystemFailureReportingForTest } from "@/shared/systemFailure";

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("sonner", () => ({ toast: toastMocks }));

const reactActEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const settings: VideoDownloadSettings = {
  mode: "auto",
  quality: "1080",
  container: "mp4",
  codec: "h264",
  audioFormat: "best",
};

const taskFrom = <Result,>(promise: Promise<Result>): VideoDownloadTask<Result> => {
  const controller = new AbortController();
  return {
    promise,
    signal: controller.signal,
    abort: () => controller.abort(),
  };
};

const resolvedFile = (filename: string, contents = "file"): VideoFileDownloadResult => ({
  status: "file",
  file: new File([contents], filename),
  release: vi.fn(async () => undefined),
});

const setSourceUrl = async (renderer: ReactTestRenderer, sourceUrl: string) => {
  await act(async () => {
    renderer.root.findByProps({ name: "media-url" }).props.onChange({
      target: { value: sourceUrl },
    });
  });
};

const submit = async (renderer: ReactTestRenderer) => {
  await act(async () => {
    await renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
  });
};

const captureEvents = () => {
  const events: AnalyticsEvent[] = [];
  return {
    events,
    capture: vi.fn((event: AnalyticsEvent) => {
      events.push(event);
    }),
  };
};

describe("tagium save app", () => {
  beforeEach(() => {
    resetSystemFailureReportingForTest();
    toastMocks.error.mockClear();
  });

  it("keeps codec and container settings compatible", () => {
    const webm = updateVideoDownloadSettings(settings, { key: "container", value: "webm" });
    expect(webm).toMatchObject({ container: "webm", codec: "vp9" });

    const h264 = updateVideoDownloadSettings(webm, { key: "codec", value: "h264" });
    expect(h264).toMatchObject({ container: "mp4", codec: "h264" });

    const matroska = updateVideoDownloadSettings(h264, { key: "container", value: "mkv" });
    expect(updateVideoDownloadSettings(matroska, { key: "codec", value: "av1" })).toMatchObject({
      container: "mkv",
      codec: "av1",
    });
  });

  it("keeps the download failure reason visible", () => {
    const failure = presentVideoDownloadFailure(
      new VideoDownloadError(
        "planning",
        "too many downloads too quickly. wait a moment, then try again.",
        "rate_limited",
      ),
    );

    expect(failure).toMatchObject({
      code: "rate_limited",
      trackDescription: "too many download requests. try again shortly.",
      retryable: true,
    });
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("tracks one complete lifecycle for a direct file", async () => {
    const { capture, events } = captureEvents();
    const result = resolvedFile("clip.mp4", "video");
    const startDownload = vi.fn(() => taskFrom<VideoDownloadResult>(Promise.resolve(result)));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<TagiumSaveApp startDownload={startDownload} capture={capture} />);
    });
    await setSourceUrl(renderer, "https://www.youtube.com/watch?v=abcdefghijk");
    await submit(renderer);

    expect(events.map((event) => event.type)).toEqual([
      "media_link_processed",
      "download_started",
      "download_resolved",
      "download_finished",
    ]);
    expect(events[0]).toMatchObject({
      mediaKind: "media",
      linkKind: "canonical",
      outcome: "accepted",
    });
    expect(events[1]).toMatchObject({
      requestedMode: "auto",
      requestedVideoQuality: "1080",
      requestedContainer: "mp4",
      requestedCodec: "h264",
      requestedAudioFormat: "best",
      isRetry: false,
    });
    expect(events[2]).toMatchObject({ resultKind: "file", resourceCount: 1 });
    expect(events[3]).toMatchObject({
      outcome: "completed",
      outputFormat: "mp4",
      sizeBytes: result.file.size,
    });

    act(() => renderer.unmount());
  });

  it("keeps picker selection in the lifecycle that resolved it", async () => {
    const { capture, events } = captureEvents();
    const selected = resolvedFile("selected.webm");
    const picker: VideoPickerDownloadResult = {
      status: "picker",
      picker: [{ type: "video", url: "https://private.example/selected" }],
      audioFilename: "private-audio.mp3",
      downloadAudio: () => taskFrom(Promise.resolve(resolvedFile("audio.mp3"))),
      download: vi.fn(() => taskFrom(Promise.resolve(selected))),
    };
    const startDownload = vi.fn(() => taskFrom<VideoDownloadResult>(Promise.resolve(picker)));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<TagiumSaveApp startDownload={startDownload} capture={capture} />);
    });
    await setSourceUrl(renderer, "https://example.test/post/picker");
    await submit(renderer);

    expect(events.filter((event) => event.type === "download_finished")).toHaveLength(0);
    expect(events.find((event) => event.type === "download_resolved")).toMatchObject({
      resultKind: "picker",
      resourceCount: 2,
    });

    await act(async () => {
      renderer.root.findByProps({ "aria-label": "download video 1" }).props.onClick();
      await Promise.resolve();
    });

    expect(events.filter((event) => event.type === "download_started")).toHaveLength(1);
    expect(events.filter((event) => event.type === "download_finished")).toEqual([
      expect.objectContaining({ outcome: "completed", outputFormat: "webm" }),
    ]);
    expect(JSON.stringify(events)).not.toContain("private.example");
    expect(JSON.stringify(events)).not.toContain("private-audio.mp3");

    act(() => renderer.unmount());
  });

  it("tracks structured failures and marks a retry as a new lifecycle", async () => {
    const { capture, events } = captureEvents();
    const failure = new VideoDownloadError(
      "tunnel",
      "too many downloads too quickly. wait a moment, then try again.",
      "private-cobalt-code",
    );
    const completed = resolvedFile("retry.mp3");
    const startDownload = vi
      .fn()
      .mockImplementationOnce(() => taskFrom<VideoDownloadResult>(Promise.reject(failure)))
      .mockImplementationOnce(() => taskFrom<VideoDownloadResult>(Promise.resolve(completed)));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<TagiumSaveApp startDownload={startDownload} capture={capture} />);
    });
    await setSourceUrl(renderer, "https://example.test/watch/retry");
    await submit(renderer);
    expect(toastMocks.error).not.toHaveBeenCalled();
    await act(async () => {
      renderer.root.findByProps({ "aria-label": "retry download" }).props.onClick();
      await Promise.resolve();
    });

    expect(
      events.filter((event) => event.type === "download_started").map((event) => event.isRetry),
    ).toEqual([false, true]);
    expect(events.filter((event) => event.type === "download_finished")).toEqual([
      expect.objectContaining({
        outcome: "failed",
        failureStage: "tunnel",
        failureCode: "rate_limited",
      }),
      expect.objectContaining({ outcome: "completed", outputFormat: "mp3" }),
    ]);
    expect(events.some((event) => "error" in event || "retryable" in event)).toBe(false);

    act(() => renderer.unmount());
  });

  it("tracks the safe output format before handing a recent file to the browser", async () => {
    const trace: string[] = [];
    const events: AnalyticsEvent[] = [];
    const capture = vi.fn((event: AnalyticsEvent) => {
      events.push(event);
      trace.push(event.type);
    });
    const handoffDownload = vi.fn(() => {
      trace.push("browser_handoff");
    });
    const result: VideoFileDownloadResult = {
      ...resolvedFile("private-release.mov"),
      file: new File(["private"], "private-release.mov", { type: "video/private" }),
    };
    const startDownload = vi.fn(() => taskFrom<VideoDownloadResult>(Promise.resolve(result)));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <TagiumSaveApp
          startDownload={startDownload}
          capture={capture}
          handoffDownload={handoffDownload}
        />,
      );
    });
    await setSourceUrl(renderer, "https://example.test/watch/export");
    await submit(renderer);
    act(() => {
      renderer.root.findByProps({ "aria-label": "download private-release.mov" }).props.onClick();
    });

    expect(trace.slice(-2)).toEqual(["export_prepared", "browser_handoff"]);
    expect(events.filter((event) => event.type === "download_finished")).toEqual([
      expect.objectContaining({ outcome: "completed", outputFormat: "other" }),
    ]);
    expect(events.filter((event) => event.type === "export_prepared")).toEqual([
      expect.objectContaining({
        exportKind: "track",
        trackCount: 1,
        outputFormat: "other",
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("private-release.mov");
    expect(JSON.stringify(events)).not.toContain("video/private");
    expect(handoffDownload).toHaveBeenCalledWith(result.file);

    act(() => renderer.unmount());
  });

  it("releases completed files when they leave the five-item list or the app unmounts", async () => {
    const releases = Array.from({ length: 6 }, () => vi.fn(async () => undefined));
    let resultIndex = 0;
    const startDownload = vi.fn(() => {
      const index = resultIndex++;
      const controller = new AbortController();
      return {
        signal: controller.signal,
        abort: () => controller.abort(),
        promise: Promise.resolve({
          status: "file" as const,
          file: new File([`file-${index}`], `clip-${index}.mp4`),
          release: releases[index],
        }),
      };
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<TagiumSaveApp startDownload={startDownload} />);
    });

    for (let index = 0; index < releases.length; index++) {
      await act(async () => {
        renderer.root.findByProps({ name: "media-url" }).props.onChange({
          target: { value: `https://example.test/watch/${index}` },
        });
      });
      await act(async () => {
        await renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
      });
    }

    expect(releases[0]).toHaveBeenCalledOnce();
    for (const release of releases.slice(1)) expect(release).not.toHaveBeenCalled();

    act(() => renderer.unmount());
    for (const release of releases) expect(release).toHaveBeenCalledOnce();
  });

  it("releases a file that completes after its operation was cancelled", async () => {
    const { capture, events } = captureEvents();
    let resolveDownload!: (result: VideoFileDownloadResult) => void;
    const release = vi.fn(async () => undefined);
    const controller = new AbortController();
    const startDownload = vi.fn(() => ({
      signal: controller.signal,
      abort: () => controller.abort(),
      promise: new Promise<VideoFileDownloadResult>((resolve) => {
        resolveDownload = resolve;
      }),
    }));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<TagiumSaveApp startDownload={startDownload} capture={capture} />);
    });
    await act(async () => {
      renderer.root.findByProps({ name: "media-url" }).props.onChange({
        target: { value: "https://example.test/watch/cancelled" },
      });
    });

    let submission!: Promise<void>;
    await act(async () => {
      submission = renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
      await Promise.resolve();
    });
    act(() => {
      renderer.root.findByProps({ "aria-label": "cancel download" }).props.onClick();
    });
    await act(async () => {
      resolveDownload({
        status: "file",
        file: new File(["late"], "late.mp4"),
        release,
      });
      await submission;
    });

    expect(release).toHaveBeenCalledOnce();
    expect(events.filter((event) => event.type === "download_finished")).toEqual([
      expect.objectContaining({ outcome: "canceled" }),
    ]);
    act(() => renderer.unmount());
    expect(events.filter((event) => event.type === "download_finished")).toHaveLength(1);
  });

  it("cancels an active lifecycle when the app unmounts", async () => {
    const { capture, events } = captureEvents();
    let resolveDownload!: (result: VideoDownloadResult) => void;
    const startDownload = vi.fn(() =>
      taskFrom<VideoDownloadResult>(
        new Promise((resolve) => {
          resolveDownload = resolve;
        }),
      ),
    );
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<TagiumSaveApp startDownload={startDownload} capture={capture} />);
    });
    await setSourceUrl(renderer, "https://example.test/watch/unmount");
    let submission!: Promise<void>;
    await act(async () => {
      submission = renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() });
      await Promise.resolve();
    });

    act(() => renderer.unmount());
    const lateFile = resolvedFile("late-after-unmount.mp4");
    await act(async () => {
      resolveDownload(lateFile);
      await submission;
    });
    expect(events.filter((event) => event.type === "download_finished")).toEqual([
      expect.objectContaining({ outcome: "canceled" }),
    ]);
    expect(lateFile.release).toHaveBeenCalledOnce();
  });
});
