import { describe, expect, it } from "vite-plus/test";
import {
  downloadServiceFromUrl,
  reportDownloadFailure,
} from "../../../server/utils/download-failure-report";
import { captureSentryEvents } from "../sentry-events";

describe("download failure report", () => {
  it("reports a youtube resolve failure grouped by service and code", async () => {
    const events = await captureSentryEvents(() =>
      reportDownloadFailure({
        route: "download",
        stage: "cobalt.resolve_error",
        requestId: "request-test",
        errorCode: "error.api.content.video.unavailable",
        sourceUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        upstreamStatus: 400,
        machineId: "683e532b0e3328",
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      message: "youtube download failed: error.api.content.video.unavailable",
      level: "error",
      fingerprint: [
        "download-failure",
        "download",
        "youtube",
        "error.api.content.video.unavailable",
      ],
      tags: {
        route: "download",
        service: "youtube",
        stage: "cobalt.resolve_error",
        error_code: "error.api.content.video.unavailable",
        upstream_status: 400,
        machine_id: "683e532b0e3328",
        request_id: "request-test",
      },
    });
  });

  it("skips cobalt errors caused by user input", async () => {
    const events = await captureSentryEvents(() =>
      reportDownloadFailure({
        route: "audio",
        stage: "cobalt.resolve_error",
        requestId: "request-test",
        errorCode: "error.api.link.unsupported",
        sourceUrl: "https://example.com/song",
      }),
    );

    expect(events).toEqual([]);
  });

  it("reports policy failures even when the code looks like user input", async () => {
    const events = await captureSentryEvents(() =>
      reportDownloadFailure({
        route: "download",
        stage: "cobalt.resolve_policy",
        requestId: "request-test",
        errorCode: "error.api.service.unsupported",
        sourceUrl: "https://youtu.be/dQw4w9WgXcQ",
      }),
    );

    expect(events).toHaveLength(1);
  });

  it("groups tunnel failures by stage when there is no error code", async () => {
    const events = await captureSentryEvents(() =>
      reportDownloadFailure({ route: "tunnel", stage: "upstream empty body", requestId: "tunnel" }),
    );

    expect(events[0]?.message).toBe("unknown tunnel failed: upstream empty body");
  });

  it.each([
    ["https://soundcloud.com/forss/flickermood", "soundcloud"],
    ["https://youtu.be/dQw4w9WgXcQ", "youtube"],
    ["https://vimeo.com/1", "other"],
    ["not a url", "other"],
    [undefined, "unknown"],
  ])("maps %s to %s", (url, service) => {
    expect(downloadServiceFromUrl(url)).toBe(service);
  });
});
