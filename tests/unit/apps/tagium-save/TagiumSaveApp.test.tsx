import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { AnalyticsEvent } from "@/analytics";
import TagiumSaveApp from "@/apps/tagium-save/TagiumSaveApp";
import {
  buildVideoDownloadRequest,
  getDownloadReadyAnnouncement,
  getVideoDownloadPhaseLabel,
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

  it("builds a browser-processing request from the compact controls", () => {
    expect(
      buildVideoDownloadRequest("https://example.com/watch/one", {
        ...settings,
        mode: "mute",
        quality: "720",
        container: "webm",
        codec: "vp9",
        audioFormat: "opus",
      }),
    ).toEqual({
      sourceUrl: "https://example.com/watch/one",
      downloadMode: "mute",
      videoQuality: "720",
      youtubeVideoContainer: "webm",
      youtubeVideoCodec: "vp9",
      audioFormat: "opus",
      filenameStyle: "pretty",
    });
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
    expect(toastMocks.error).toHaveBeenCalledWith("too many download requests", {
      id: "system-download-rate-limited",
      description: "wait a moment, then try the download again.",
    });
  });

  it("labels each browser download phase", () => {
    expect(
      (["planning", "waiting-for-tunnel", "downloading", "processing", "finalizing"] as const).map(
        getVideoDownloadPhaseLabel,
      ),
    ).toEqual(["preparing", "waiting", "downloading", "processing", "finalizing"]);
  });

  it("keeps one polite completion announcement mounted", () => {
    const markup = renderToStaticMarkup(<TagiumSaveApp />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('aria-atomic="true"');
    expect(getDownloadReadyAnnouncement("My Clip.mp4")).toBe("download ready: My Clip.mp4");
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

  it("tracks rejected media links without starting a download", async () => {
    const { capture, events } = captureEvents();
    const startDownload = vi.fn(() =>
      taskFrom<VideoDownloadResult>(Promise.resolve(resolvedFile("unused.mp4"))),
    );
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<TagiumSaveApp startDownload={startDownload} capture={capture} />);
    });
    await setSourceUrl(renderer, "not a url");
    await submit(renderer);

    expect(startDownload).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: "media_link_processed",
        sourceUrl: "not a url",
        mediaKind: "media",
        linkKind: "other",
        normalized: false,
        redirected: false,
        outcome: "rejected",
        failureReason: "invalid",
      },
    ]);

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

  it("finishes a picker lifecycle once when it is reset", async () => {
    const { capture, events } = captureEvents();
    const picker: VideoPickerDownloadResult = {
      status: "picker",
      picker: [{ type: "photo", url: "https://private.example/photo" }],
      download: () => taskFrom(Promise.resolve(resolvedFile("photo.jpg"))),
    };
    const startDownload = vi.fn(() => taskFrom<VideoDownloadResult>(Promise.resolve(picker)));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<TagiumSaveApp startDownload={startDownload} capture={capture} />);
    });
    await setSourceUrl(renderer, "https://example.test/post/reset");
    await submit(renderer);

    act(() => {
      renderer.root.findByProps({ "aria-label": "reset download" }).props.onClick();
    });
    expect(events.filter((event) => event.type === "download_finished")).toEqual([
      expect.objectContaining({ outcome: "canceled" }),
    ]);

    act(() => renderer.unmount());
    expect(events.filter((event) => event.type === "download_finished")).toHaveLength(1);
  });

  it("fails an empty picker without emitting a resolved event", async () => {
    const { capture, events } = captureEvents();
    const picker: VideoPickerDownloadResult = {
      status: "picker",
      picker: [],
      download: vi.fn(),
    };
    const startDownload = vi.fn(() => taskFrom<VideoDownloadResult>(Promise.resolve(picker)));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<TagiumSaveApp startDownload={startDownload} capture={capture} />);
    });
    await setSourceUrl(renderer, "https://example.test/post/empty-picker");
    await submit(renderer);

    expect(events.filter((event) => event.type === "download_resolved")).toHaveLength(0);
    expect(events.filter((event) => event.type === "download_finished")).toEqual([
      expect.objectContaining({
        outcome: "failed",
        failureStage: "planning",
        failureCode: "invalid_response",
      }),
    ]);

    act(() => renderer.unmount());
    expect(events.filter((event) => event.type === "download_finished")).toHaveLength(1);
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

  it("links the save attribution to flamboh and cobalt", () => {
    const markup = renderToStaticMarkup(<TagiumSaveApp />);

    expect(markup).toContain("made by");
    expect(markup).toContain('href="https://x.com/flambohh"');
    expect(markup).toContain(">flamboh</a>");
    expect(markup).toContain("powered by");
    expect(markup).toContain('href="https://cobalt.tools/"');
    expect(markup).toContain(">cobalt</a>");
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

  it("reuses the landing primitives without adding a marketing surface", () => {
    const markup = renderToStaticMarkup(<TagiumSaveApp />);

    expect(markup).toContain("tagium");
    expect(markup).toContain("save");
    expect(markup).toContain('data-layout="standalone"');
    expect(markup).toContain('name="media-url"');
    expect(markup).toContain("paste a media link");
    expect(markup).toContain("download settings");
    expect(markup.indexOf("download settings")).toBeLessThan(markup.indexOf('name="media-url"'));
    expect(markup).not.toContain("save a link. keep the file.");
    expect(markup).not.toContain("processing stays in your browser");
    expect(markup).not.toContain("rate limited");
    expect(markup).not.toContain("soundcloud, youtube");
    expect(markup).not.toContain("tagium / video");
    expect(markup).not.toContain("video · tagium");
    expect(markup).not.toContain("choose a file");
    expect(markup).not.toContain("your file is ready");
  });
});
