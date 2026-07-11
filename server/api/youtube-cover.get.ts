import { defineHandler } from "nitro";

const MAX_COVER_BYTES = 25 * 1024 * 1024;
const YOUTUBE_COVER_TIMEOUT_MS = 15_000;
const supportedTypes = new Set(["image/jpeg", "image/jpg", "image/png"]);

const parseYouTubeCoverUrl = (request: Request) => {
  const requestUrl = new URL(request.url, "http://tagium.local");
  const coverUrlParam = requestUrl.searchParams.get("url");
  if (!coverUrlParam) return undefined;

  try {
    const coverUrl = new URL(coverUrlParam);
    if (coverUrl.protocol !== "https:" || coverUrl.hostname !== "i.ytimg.com") return undefined;
    return coverUrl;
  } catch {
    return undefined;
  }
};

export default defineHandler(async (event) => {
  const coverUrl = parseYouTubeCoverUrl(event.req);
  if (!coverUrl) return new Response("Invalid YouTube cover URL.", { status: 400 });

  try {
    const response = await fetch(coverUrl.toString(), {
      signal: AbortSignal.any([event.req.signal, AbortSignal.timeout(YOUTUBE_COVER_TIMEOUT_MS)]),
    });
    if (!response.ok) {
      return new Response(`YouTube cover request failed (${response.status}).`, { status: 502 });
    }

    const contentTypeHeader = response.headers.get("content-type") ?? "";
    const contentType = contentTypeHeader.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!supportedTypes.has(contentType)) {
      return new Response("YouTube cover response was not a JPEG or PNG.", { status: 502 });
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_COVER_BYTES) {
      return new Response("YouTube cover response was too large.", { status: 502 });
    }

    const body = await response.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_COVER_BYTES) {
      return new Response("YouTube cover response had an invalid size.", { status: 502 });
    }

    return new Response(body, {
      headers: {
        "Cache-Control": "public, max-age=21600",
        "Content-Type": contentType === "image/jpg" ? "image/jpeg" : contentType,
      },
    });
  } catch {
    return new Response("YouTube cover request failed.", { status: 502 });
  }
});
