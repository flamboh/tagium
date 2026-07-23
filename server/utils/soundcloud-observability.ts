import {
  fingerprintUrl,
  getRequestLogContext,
  type RequestLogContext,
} from "./request-observability";

export type SoundCloudLogContext = RequestLogContext;
export const getSoundCloudLogContext = getRequestLogContext;

export const logSoundCloudFailure = async (
  stage: string,
  context: SoundCloudLogContext,
  details: Record<string, unknown> = {},
  startedAt = Date.now(),
) => {
  const urlFingerprint = await fingerprintUrl(context.url);
  console.warn(
    JSON.stringify({
      event: "soundcloud_upstream_failure",
      stage,
      elapsedMs: Date.now() - startedAt,
      ...(urlFingerprint ? { urlFingerprint } : {}),
      requestId: context.requestId,
      ...(context.importId ? { importId: context.importId } : {}),
      ...(context.trackIndex !== undefined ? { trackIndex: context.trackIndex } : {}),
      ...details,
    }),
  );
};

export const logSoundCloudCompletion = async (
  context: SoundCloudLogContext,
  details: Record<string, unknown>,
) => {
  const urlFingerprint = await fingerprintUrl(context.url);
  console.info(
    JSON.stringify({
      event: "soundcloud_set_completion",
      ...(urlFingerprint ? { urlFingerprint } : {}),
      requestId: context.requestId,
      ...(context.importId ? { importId: context.importId } : {}),
      ...(context.trackIndex !== undefined ? { trackIndex: context.trackIndex } : {}),
      ...details,
    }),
  );
};
