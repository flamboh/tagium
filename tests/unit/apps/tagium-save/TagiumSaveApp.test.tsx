import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import TagiumSaveApp from "@/apps/tagium-save/TagiumSaveApp";
import {
  buildVideoDownloadRequest,
  getDownloadReadyAnnouncement,
  getVideoDownloadPhaseLabel,
  presentVideoDownloadFailure,
  updateVideoDownloadSettings,
  type VideoDownloadSettings,
} from "@/apps/tagium-save/tagiumSaveModel";
import { VideoDownloadError, type VideoFileDownloadResult } from "@/apps/tagium-save/download";
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
      renderer = create(<TagiumSaveApp startDownload={startDownload} />);
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
    act(() => renderer.unmount());
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
