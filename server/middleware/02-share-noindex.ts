import { defineHandler } from "nitro";

// This middleware is the Nitro seam before the SPA fallback serves /share/:slug.
export default defineHandler((event) => {
  const url = new URL(event.req.url);

  if (url.hostname.toLowerCase() === "save.tagium.app") {
    event.res.headers.set("X-Robots-Tag", "noindex, nofollow");

    return;
  }

  if (url.pathname === "/share" || url.pathname.startsWith("/share/")) {
    event.res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
});
