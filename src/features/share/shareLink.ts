const SHARE_SLUG_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const PRODUCTION_ORIGINS = new Set(["https://tagium.app", "https://www.tagium.app"]);

export type ShareLinkClassification =
  | { kind: "media" }
  | { kind: "share"; slug: string }
  | { kind: "invalid-share" };

export const classifyShareLink = (
  value: string,
  currentOrigin = typeof location === "undefined" ? "" : location.origin,
): ShareLinkClassification => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { kind: "media" };
  }
  const isTagiumOrigin = PRODUCTION_ORIGINS.has(url.origin) || url.origin === currentOrigin;
  if (!isTagiumOrigin) return { kind: "media" };
  const match = url.pathname.match(/^\/share\/([^/]+)\/?$/);
  if (
    !match ||
    !SHARE_SLUG_PATTERN.test(match[1] ?? "") ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    return { kind: "invalid-share" };
  }
  return { kind: "share", slug: match[1]! };
};

export const shareSlugFromPathname = (pathname: string) => {
  const match = pathname.match(/^\/share\/([A-Za-z0-9_-]{22})\/?$/);
  return match?.[1] ?? null;
};

export const shareLinkForSlug = (
  slug: string,
  origin = typeof location === "undefined" ? "https://tagium.app" : location.origin,
) => new URL(`/share/${slug}`, origin).toString();

export class InvalidShareLinkError extends Error {
  constructor() {
    super("that isn’t a tagium share link");
    this.name = "InvalidShareLinkError";
  }
}

export class ShareLinksDisabledError extends Error {
  constructor() {
    super("share links are not available right now");
    this.name = "ShareLinksDisabledError";
  }
}
