import { FAKE_LRCLIB_API_KEY, FAKE_LRCLIB_APP_ID, lyricsKey } from "../protocol.ts";
import { json } from "./assets.ts";
import { unexpected, type FakeRequest, type FakeResult } from "./types.ts";

export const fakeLrclib = (request: FakeRequest): FakeResult => {
  const { pathname, searchParams } = request.url;

  if (pathname !== "/api/get" && pathname !== "/api/search") {
    return unexpected("lrclib.unknown_route");
  }

  const route = pathname === "/api/get" ? "lrclib.get" : "lrclib.search";
  const key = lyricsKey(searchParams.get("track_name") ?? "");
  const scenario = request.registry.lyrics(key);

  if (!scenario) return unexpected(route, key);

  if (
    request.headers.get("lrclib-app-id") !== FAKE_LRCLIB_APP_ID ||
    request.headers.get("lrclib-api-key") !== FAKE_LRCLIB_API_KEY
  ) {
    return {
      route,
      key,
      response: json({ name: "InvalidApiKeyError", statusCode: 401 }, { status: 401 }),
    };
  }

  const fault = request.registry.nextLyricsFault(key);

  if (fault !== "ok") {
    return {
      route,
      key,
      response: json(
        { statusCode: fault },
        { status: fault, headers: fault === 500 ? {} : { "retry-after": "1" } },
      ),
    };
  }

  if (pathname === "/api/search") return { route, key, response: json(scenario.search) };

  return {
    route,
    key,
    response: scenario.exact
      ? json(scenario.exact)
      : json({ name: "TrackNotFound", statusCode: 404 }, { status: 404 }),
  };
};
