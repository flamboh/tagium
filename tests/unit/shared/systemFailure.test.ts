import { describe, expect, it } from "vite-plus/test";
import { importFailureCodeFrom } from "@/features/import/importLifecycle";
import {
  getSystemFailurePresentation,
  getTrackFailureDisplay,
  type SystemFailureCode,
} from "@/shared/systemFailure";

const cases: Array<{ message: string; code: SystemFailureCode; retryable: boolean }> = [
  { message: "error.api.capacity_exceeded", code: "capacity", retryable: true },
  { message: "error.api.rate_exceeded", code: "rate_limited", retryable: true },
  { message: "Download rate limit exceeded.", code: "rate_limited", retryable: true },
  { message: "error.api.timed_out", code: "timeout", retryable: true },
  { message: "Cobalt tunnel request timed out.", code: "timeout", retryable: true },
  { message: "error.api.unreachable", code: "service_unavailable", retryable: true },
  { message: "Failed to fetch", code: "service_unavailable", retryable: true },
  { message: "Load failed", code: "service_unavailable", retryable: true },
  {
    message: "Download admission is unavailable.",
    code: "service_unavailable",
    retryable: true,
  },
  { message: "error.api.link.unsupported", code: "unsupported_source", retryable: false },
  { message: "unsupported url", code: "unsupported_source", retryable: false },
  { message: "error.api.soundcloud.maybe_drm", code: "drm_protected", retryable: false },
  { message: "error.api.youtube.drm", code: "drm_protected", retryable: false },
  { message: "error.api.soundcloud.no_stream", code: "no_stream", retryable: false },
  { message: "error.api.content.paid", code: "paid_preview", retryable: false },
  { message: "error.api.content.region", code: "region_locked", retryable: false },
  { message: "error.api.content.video.region", code: "region_locked", retryable: false },
  { message: "error.api.content.too_long", code: "too_long", retryable: false },
  { message: "error.api.content.video.live", code: "live_stream", retryable: false },
  { message: "error.api.content.video.age", code: "age_restricted", retryable: false },
  { message: "error.api.content.post.age", code: "age_restricted", retryable: false },
  { message: "error.api.content.video.private", code: "private_or_missing", retryable: false },
  { message: "error.api.content.post.private", code: "private_or_missing", retryable: false },
  {
    message: "error.api.content.post.unavailable",
    code: "private_or_missing",
    retryable: false,
  },
  {
    message: "soundcloud set request failed (404)",
    code: "private_or_missing",
    retryable: false,
  },
  {
    message: "youtube playlist request failed (404)",
    code: "private_or_missing",
    retryable: false,
  },
  { message: "soundcloud set request failed (422)", code: "playlist_empty", retryable: false },
  { message: "youtube playlist request failed (422)", code: "playlist_empty", retryable: false },
  {
    message: "soundcloud short-link resolution failed",
    code: "short_link_unresolved",
    retryable: false,
  },
  { message: "soundcloud short-link lookup failed", code: "unknown", retryable: true },
  {
    message: "error.api.content.video.unavailable",
    code: "video_unavailable",
    retryable: false,
  },
  { message: "error.api.youtube.login", code: "provider_blocked", retryable: true },
  { message: "error.api.youtube.no_session_tokens", code: "provider_blocked", retryable: true },
  { message: "error.api.youtube.token_expired", code: "provider_blocked", retryable: true },
  { message: "error.api.youtube.decipher", code: "provider_blocked", retryable: true },
  { message: "error.api.youtube.api_error", code: "provider_blocked", retryable: true },
  { message: "error.api.fetch.rate", code: "provider_blocked", retryable: true },
  { message: "Cobalt tunnel request failed (401).", code: "link_expired", retryable: true },
  { message: "Cobalt tunnel request failed (403).", code: "link_expired", retryable: true },
  { message: "Cobalt tunnel request failed (404).", code: "link_expired", retryable: true },
  {
    message: "soundcloud stream part request failed (403).",
    code: "link_expired",
    retryable: true,
  },
  {
    message: "soundcloud stream part request failed (404).",
    code: "link_expired",
    retryable: true,
  },
  {
    message: "local video processing is unavailable in this browser.",
    code: "browser_unsupported",
    retryable: false,
  },
  { message: "downloaded track could not be parsed.", code: "parse_failed", retryable: false },
  {
    message: "local audio processing produced an empty file.",
    code: "processing_failed",
    retryable: true,
  },
  {
    message: "local audio processing failed: ffmpeg exited",
    code: "processing_failed",
    retryable: true,
  },
  { message: "error.api.fetch.empty", code: "invalid_response", retryable: true },
  { message: "Cobalt tunnel response was empty.", code: "invalid_response", retryable: true },
  { message: "error.api.fetch.fail", code: "unknown", retryable: true },
  { message: "error.api.handler_failure", code: "unknown", retryable: true },
  { message: "Cobalt tunnel request failed (500).", code: "unknown", retryable: true },
  { message: "playlist download item not found.", code: "unknown", retryable: true },
  { message: "album cover request failed (404)", code: "unknown", retryable: true },
  { message: "download failed.", code: "unknown", retryable: true },
];

describe("download failure presentation", () => {
  it.each(cases)("presents $message as $code", ({ message, code, retryable }) => {
    const presentation = getSystemFailurePresentation(new Error(message), "download");

    expect(presentation).toMatchObject({ code, retryable });
    expect(importFailureCodeFrom(new Error(message))).toBe(code);
  });

  it.each(cases)("keeps $code tracks retryable only when retry can help", ({ message }) => {
    const presentation = getSystemFailurePresentation(new Error(message), "download");

    expect(getTrackFailureDisplay(presentation.trackDescription)).toEqual({
      title: presentation.title,
      description: presentation.trackDescription,
      retryable: presentation.retryable,
    });
  });

  it("keeps every track description distinct so stored failures stay recognizable", () => {
    const descriptions = new Map<string, SystemFailureCode>();

    for (const { message } of cases) {
      const presentation = getSystemFailurePresentation(new Error(message), "download");
      const existing = descriptions.get(presentation.trackDescription);

      expect(existing ?? presentation.code).toBe(presentation.code);
      descriptions.set(presentation.trackDescription, presentation.code);
    }
  });

  it("keeps all copy lowercase", () => {
    for (const { message } of cases) {
      const { title, description, trackDescription } = getSystemFailurePresentation(
        new Error(message),
        "download",
      );

      for (const text of [title, description, trackDescription]) {
        expect(text).toBe(text.toLowerCase());
      }
    }
  });
});
