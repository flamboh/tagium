import {
  FAKE_COBALT_ORIGIN,
  FAKE_DIRECT_MEDIA_ORIGIN,
  FAKE_POSTHOG_ORIGIN,
  type UpstreamCall,
} from "../protocol.ts";
import type { Registry } from "../registry.ts";
import { fontResponse } from "./assets.ts";
import { fakeCobalt, fakeDirectMedia } from "./cobalt.ts";
import {
  fakeSoundCloudApi,
  fakeSoundCloudArtwork,
  fakeSoundCloudShortLink,
  fakeSoundCloudWeb,
} from "./soundcloud.ts";
import { fakePostHog } from "./posthog.ts";
import { unexpected, type FakeRequest, type FakeResult } from "./types.ts";
import { fakeYouTube, fakeYouTubeImages } from "./youtube.ts";

const cobaltHost = new URL(FAKE_COBALT_ORIGIN).host;
const directMediaHost = new URL(FAKE_DIRECT_MEDIA_ORIGIN).host;
const postHogHost = new URL(FAKE_POSTHOG_ORIGIN).host;
const FONT_URL = "https://api.fontshare.com/e2e/satoshi.ttf";

const fakeFontshare = (request: FakeRequest): FakeResult => {
  if (request.url.pathname === "/v2/css") {
    return {
      route: "fontshare.css",
      key: null,
      response: new Response(
        `@font-face{font-family:'Satoshi';src:url('${FONT_URL}') format('truetype');}`,
        { headers: { "content-type": "text/css" } },
      ),
    };
  }
  if (request.url.toString() === FONT_URL) {
    return { route: "fontshare.font", key: null, response: fontResponse() };
  }
  return unexpected("fontshare.unknown_route");
};

const dispatch = (request: FakeRequest): FakeResult => {
  const host = request.url.host.toLowerCase();
  if (host === cobaltHost) return fakeCobalt(request);
  if (host === directMediaHost) return fakeDirectMedia(request);
  if (host === "www.youtube.com" || host === "youtube.com") return fakeYouTube(request);
  if (host === "i.ytimg.com") return fakeYouTubeImages(request);
  if (host === "soundcloud.com" || host === "www.soundcloud.com") return fakeSoundCloudWeb(request);
  if (host === "api-v2.soundcloud.com") return fakeSoundCloudApi(request);
  if (/^i\d\.sndcdn\.com$/u.test(host)) return fakeSoundCloudArtwork(request);
  if (host === "on.soundcloud.com" || host === "snd.sc") return fakeSoundCloudShortLink(request);
  if (host === "api.fontshare.com") return fakeFontshare(request);
  if (host === postHogHost) return fakePostHog(request);
  return unexpected("unknown_host");
};

export const handleUpstream = async (
  registry: Registry,
  origin: UpstreamCall["origin"],
  request: Request,
  fallbackOwner: string | null = null,
): Promise<Response> => {
  const url = new URL(request.url);
  const bodyBytes =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : new Uint8Array(await request.arrayBuffer());
  const body = bodyBytes && new TextDecoder().decode(bodyBytes);
  const fake: FakeRequest = {
    registry,
    method: request.method,
    url,
    headers: request.headers,
    body,
    bodyBytes,
  };
  let result: FakeResult;
  try {
    result = dispatch(fake);
  } catch (error) {
    result = unexpected(`handler_threw: ${error instanceof Error ? error.message : String(error)}`);
  }
  const call: UpstreamCall = {
    at: Date.now(),
    origin,
    method: request.method,
    url: url.toString(),
    host: url.host,
    route: result.route,
    key: result.key,
    owner: registry.ownerOf(result.key) ?? fallbackOwner,
    status: 0,
    unexpected: result.unexpected === true,
    requestHeaders: Object.fromEntries(request.headers),
  };
  const recordedBody = result.body ?? body;
  if (recordedBody !== undefined) call.requestBody = recordedBody;
  registry.record(call);
  const response = await result.response;
  call.status = response.status;
  return response;
};
