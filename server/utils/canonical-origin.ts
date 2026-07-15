export const CANONICAL_ORIGIN = "https://tagium.app";

const redirectHostnames = new Set(["tagium.oli.boo", "www.tagium.app"]);

export const getCanonicalRedirectUrl = (requestUrl: string) => {
  const url = new URL(requestUrl);
  if (!redirectHostnames.has(url.hostname.toLowerCase())) return undefined;

  const canonicalUrl = new URL(url);
  canonicalUrl.protocol = "https:";
  canonicalUrl.hostname = "tagium.app";
  canonicalUrl.port = "";
  canonicalUrl.hash = "";
  return canonicalUrl.toString();
};
