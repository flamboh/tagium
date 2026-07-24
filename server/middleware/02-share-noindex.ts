import { defineHandler } from "nitro";

// This middleware is the Nitro seam before the SPA fallback serves /share/:slug.
export default defineHandler((event) => {
  if (/^\/share\/[A-Za-z0-9_-]{22}\/?$/.test(new URL(event.req.url).pathname)) {
    event.res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
});
