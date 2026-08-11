import { defineHandler } from "nitro";
import { SHARE_SLUG_PATTERN } from "../../src/features/share/shareSlug";

// This middleware is the Nitro seam before the SPA fallback serves /share/:slug.
export default defineHandler((event) => {
  const pathname = new URL(event.req.url).pathname;
  const match = pathname.match(/^\/share\/([^/]+)\/?$/);
  if (SHARE_SLUG_PATTERN.test(match?.[1] ?? "")) {
    event.res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
});
