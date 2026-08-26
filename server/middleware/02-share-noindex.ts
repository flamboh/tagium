import { defineHandler } from "nitro";
import { SHARE_SLUG_PATTERN } from "../../src/features/share/shareSlug";

// This middleware is the Nitro seam before the SPA fallback serves /share/:slug.
export default defineHandler((event) => {
  const url = new URL(event.req.url);
  if (url.hostname.toLowerCase() === "save.tagium.app") {
    event.res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return;
  }

  const { pathname } = url;
  const match = pathname.match(/^\/share\/([^/]+)\/?$/);
  if (SHARE_SLUG_PATTERN.test(match?.[1] ?? "")) {
    event.res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
});
