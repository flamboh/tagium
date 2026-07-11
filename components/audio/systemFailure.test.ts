import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  getSystemFailurePresentation,
  getTrackFailureDisplay,
  reportSystemFailure,
  resetSystemFailureReportingForTest,
} from "./systemFailure";

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("sonner", () => ({ toast: toastMocks }));

beforeEach(() => {
  resetSystemFailureReportingForTest();
  toastMocks.error.mockClear();
  vi.useRealTimers();
});

describe("system failure reporting", () => {
  it.each([
    ["error.api.capacity_exceeded", "capacity", "downloads are busy"],
    ["Cobalt tunnel request failed (429)", "rate_limited", "too many download requests"],
    ["error.api.timed_out", "timeout", "the download took too long"],
    ["error.api.unreachable", "service_unavailable", "downloads are temporarily unavailable"],
  ] as const)("maps %s to safe public copy", (message, code, title) => {
    expect(getSystemFailurePresentation(new Error(message), "download")).toMatchObject({
      code,
      title,
    });
  });

  it("uses a safe contextual fallback instead of exposing an unknown cause", () => {
    const presentation = getSystemFailurePresentation(
      new Error("private upstream body and URL"),
      "export",
    );

    expect(presentation).toMatchObject({
      code: "unknown",
      title: "export failed",
      description: "tagium could not prepare your download. Your tracks are still in the library.",
    });
    expect(JSON.stringify(presentation)).not.toContain("private upstream");
  });

  it("reports every explicit export failure", () => {
    reportSystemFailure(new Error("first private cause"), "export");
    reportSystemFailure(new Error("second private cause"), "export");

    expect(toastMocks.error).toHaveBeenCalledTimes(2);
    expect(toastMocks.error).toHaveBeenLastCalledWith("export failed", {
      description: "tagium could not prepare your download. Your tracks are still in the library.",
    });
  });

  it("deduplicates repeated background download failures by category", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    reportSystemFailure(new Error("error.api.rate_exceeded"), "download");
    reportSystemFailure(new Error("Cobalt request failed with 429"), "download");

    expect(toastMocks.error).toHaveBeenCalledTimes(1);
  });

  it("returns safe durable track copy to the caller that records recovery state", () => {
    const presentation = reportSystemFailure(new Error("private decoder detail"), "download");

    expect(presentation.trackDescription).toBe("download failed. try again or use another link.");
    expect(getTrackFailureDisplay(presentation.trackDescription)).toEqual({
      title: "download failed",
      description: "download failed. try again or use another link.",
    });
  });

  it("keeps durable metadata failures distinct from download failures", () => {
    const presentation = getSystemFailurePresentation(
      new Error("private writer detail"),
      "metadata",
    );

    expect(getTrackFailureDisplay(presentation.trackDescription)).toEqual({
      title: "metadata could not be saved",
      description: "metadata could not be saved. try again.",
    });
  });

  it("does not classify provider phrases outside download and import contexts", () => {
    expect(
      getSystemFailurePresentation(new Error("metadata record not found"), "metadata"),
    ).toMatchObject({
      code: "unknown",
      title: "metadata could not be saved",
      description: "Your edits are still visible. Try the action again.",
    });

    expect(
      getSystemFailurePresentation(new Error("export failed with rate limit 429"), "export"),
    ).toMatchObject({
      code: "unknown",
      title: "export failed",
    });
  });

  it("describes automatic cover import failure without blaming a local upload", () => {
    expect(
      getSystemFailurePresentation(new Error("remote cover not found"), "cover-import"),
    ).toMatchObject({
      code: "unknown",
      title: "cover art was not imported",
      description: "The tracks were imported without cover art. Upload a jpeg or png manually.",
    });
  });
});
