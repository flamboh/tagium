export type TagiumAppId = "tagium" | "tagium-save";

interface AppLocation {
  hostname: string;
  search: string;
}

export function resolveApp({ hostname, search }: AppLocation): TagiumAppId {
  const normalizedHostname = hostname.toLowerCase();
  const supportsPreviewOverride =
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "[::1]" ||
    normalizedHostname.endsWith(".workers.dev");

  if (
    normalizedHostname === "save.tagium.app" ||
    (supportsPreviewOverride && new URLSearchParams(search).get("app") === "tagium-save")
  ) {
    return "tagium-save";
  }
  return "tagium";
}

export function getAppTitle(appId: TagiumAppId) {
  return appId === "tagium-save" ? "tagium save" : "tagium";
}
