import {
  fingerprintUrl,
  getRequestLogContext,
  type RequestLogContext,
} from "./request-observability";

export type SoundCloudLogContext = RequestLogContext;
export const getSoundCloudLogContext = getRequestLogContext;
interface SoundCloudLogObject {
  [key: string]: SoundCloudLogValue;
}
type SoundCloudLogValue = string | number | boolean | null | SoundCloudLogObject;
export type SoundCloudLogDetails = Record<string, SoundCloudLogValue | undefined>;
interface SoundCloudFailureEvent {
  event: "soundcloud_upstream_failure";
  stage: string;
  elapsedMs: number;
  requestId: string;
  urlFingerprint?: string;
  importId?: string;
  trackIndex?: number;
}
interface SoundCloudCompletionEvent {
  event: "soundcloud_set_completion";
  requestId: string;
  urlFingerprint?: string;
  importId?: string;
  trackIndex?: number;
}

export const logSoundCloudFailure = async (
  stage: string,
  context: SoundCloudLogContext,
  details: SoundCloudLogDetails = {},
  startedAt = Date.now(),
) => {
  const urlFingerprint = await fingerprintUrl(context.url);
  const entry: SoundCloudFailureEvent = {
    event: "soundcloud_upstream_failure",
    stage,
    elapsedMs: Date.now() - startedAt,
    requestId: context.requestId,
  };
  if (urlFingerprint) entry.urlFingerprint = urlFingerprint;
  if (context.importId) entry.importId = context.importId;
  if (context.trackIndex !== undefined) entry.trackIndex = context.trackIndex;
  Object.assign(entry, details);
  console.warn(JSON.stringify(entry));
};

export const logSoundCloudCompletion = async (
  context: SoundCloudLogContext,
  details: SoundCloudLogDetails,
) => {
  const urlFingerprint = await fingerprintUrl(context.url);
  const entry: SoundCloudCompletionEvent = {
    event: "soundcloud_set_completion",
    requestId: context.requestId,
  };
  if (urlFingerprint) entry.urlFingerprint = urlFingerprint;
  if (context.importId) entry.importId = context.importId;
  if (context.trackIndex !== undefined) entry.trackIndex = context.trackIndex;
  Object.assign(entry, details);
  console.info(JSON.stringify(entry));
};
