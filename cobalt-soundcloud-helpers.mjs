const errorNames = new Set([
  "AbortError",
  "TimeoutError",
  "TypeError",
  "NetworkError",
  "SyntaxError",
]);

const normalizedDetails = (details) => {
  const output = {};
  if (
    Number.isInteger(details.upstreamStatus) &&
    details.upstreamStatus >= 100 &&
    details.upstreamStatus <= 599
  ) {
    output.upstreamStatus = details.upstreamStatus;
  }
  if (
    typeof details.contentType === "string" &&
    /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(details.contentType)
  ) {
    output.contentType = details.contentType.toLowerCase();
  }
  if (typeof details.retryAfter === "string") {
    if (/^\d{1,6}$/.test(details.retryAfter)) output.retryAfter = details.retryAfter;
    else if (
      /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(details.retryAfter)
    ) {
      output.retryAfter = "http-date";
    }
  }
  if (typeof details.errorType === "string") {
    output.errorType = errorNames.has(details.errorType) ? details.errorType : "OtherError";
  }
  return output;
};

export const buildSoundCloudFailureCode = (stage, details = {}) => {
  const safe = normalizedDetails(details);
  const status = safe.upstreamStatus ? `.${safe.upstreamStatus}` : "";
  let suffix = "";
  for (const [key, value] of Object.entries(safe)) {
    if (key !== "upstreamStatus") suffix += `.${key}-${value}`;
  }
  return `fetch.soundcloud.${stage}${status}${suffix}`;
};

export const isSoundCloudResolvePayload = (value) =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
