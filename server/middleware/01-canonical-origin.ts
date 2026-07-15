import { defineHandler } from "nitro";
import { getCanonicalRedirectUrl } from "../utils/canonical-origin";

export default defineHandler((event) => {
  const redirectUrl = getCanonicalRedirectUrl(event.req.url);
  if (!redirectUrl) return;

  return new Response(null, {
    status: 308,
    headers: { Location: redirectUrl },
  });
});
