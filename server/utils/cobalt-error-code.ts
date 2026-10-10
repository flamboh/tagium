const SOUNDCLOUD_FAILURE_PREFIX = "error.api.fetch.soundcloud.";

export const isMissingSoundCloudContent = (code: string) =>
  code.startsWith(`${SOUNDCLOUD_FAILURE_PREFIX}resolve_fetch.404`);

export const publicCobaltErrorCode = (code: string) => {
  if (isMissingSoundCloudContent(code)) {
    return "error.api.content.video.unavailable";
  }
  if (
    code.startsWith(`${SOUNDCLOUD_FAILURE_PREFIX}stream_fetch`) ||
    code.startsWith(`${SOUNDCLOUD_FAILURE_PREFIX}stream_parse`)
  ) {
    return "error.api.fetch.empty";
  }
  return code.startsWith(SOUNDCLOUD_FAILURE_PREFIX) ? "error.api.fetch.fail" : code;
};
