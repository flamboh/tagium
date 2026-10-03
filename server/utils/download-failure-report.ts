import * as Sentry from "@sentry/cloudflare";
import { parseMediaLink } from "../../src/lib/media-link";

export type DownloadFailure = {
  route: "download" | "audio" | "tunnel";
  stage: string;
  requestId: string;
  errorCode?: string;
  sourceUrl?: string;
  upstreamStatus?: number;
  machineId?: string | null;
};

const userInputErrorCodes = new Set([
  "error.api.link.invalid",
  "error.api.link.unsupported",
  "error.api.service.unsupported",
  "error.api.service.audio_not_supported",
  "error.api.rate_exceeded",
]);

export const downloadServiceFromUrl = (sourceUrl: string | undefined) =>
  sourceUrl ? parseMediaLink(sourceUrl).provider : "unknown";

export const reportDownloadFailure = (failure: DownloadFailure) => {
  if (
    failure.stage === "cobalt.resolve_error" &&
    failure.errorCode &&
    userInputErrorCodes.has(failure.errorCode)
  ) {
    return;
  }

  const service = downloadServiceFromUrl(failure.sourceUrl);
  const reason = failure.errorCode ?? failure.stage;
  Sentry.withScope((scope) => {
    scope.setTags({
      route: failure.route,
      stage: failure.stage,
      service,
      error_code: failure.errorCode,
      upstream_status: failure.upstreamStatus,
      machine_id: failure.machineId ?? undefined,
      request_id: failure.requestId,
    });
    scope.setFingerprint(["download-failure", failure.route, service, reason]);
    Sentry.captureMessage(`${service} ${failure.route} failed: ${reason}`, "error");
  });
};
