# e2e harness

`bun run test:e2e` builds the app once (`vp build` with share links on and a fake PostHog key), then runs the built
Cloudflare Worker from `.output/` in Miniflare (real workerd) on `E2E_PORT` (default 4317).
Only the outside world is fake.

```
browser ──► miniflare :4317 ──► built worker (.output/server) + assets (.output/public)
   │                               │  D1 SHARE_MANIFESTS (migrations/*.sql applied)
   │                               │  R2 SHARE_ARTWORK, rate limiters (shim → control)
   │                               └─ outboundService ─┐
   └─ context.route (off-origin) ─► control :4318 ─────┴─► fakes/router.ts
                                     ▲                     cobalt · youtube · ytimg · soundcloud
          specs register scenarios ──┘                     sndcdn · on.soundcloud.com · fontshare
```

- `server.ts` starts Miniflare and the control server. Bindings come from the same
  `configureShareDeploymentBindings(..., "production")` the deploy uses, so new D1/R2/rate-limit
  bindings show up here automatically. `SENTRY_DSN` is dropped and `COBALT_API_URL` points at the
  fake Cobalt origin.
- Every outbound request from the Worker and every off-origin request from the browser goes
  through `fakes/router.ts`. Anything without a registered scenario gets a 599 response and is
  recorded as unexpected. The `upstreams` fixture fails the test that caused it.
- Scenarios are keyed by media id (YouTube video id, SoundCloud path, playlist id), and every
  test generates its own ids, so specs run fully parallel against one shared server.

## Why `TAGIUM_DEPLOY_ENV=production`

`server/utils/dev-controls.ts` only lets `local` and `preview` serve `/api/dev/*`, consume dev
fault injection, and show the dev panel. `production` makes the UI, routes and error paths match
tagium.app. Admission (`cobalt-request-admission.ts`) always uses the rate-limiter bindings when
they exist, and the same-origin checks compare `Origin` with the request URL. Both work on
`127.0.0.1` without special cases. Faults are injected at the fake upstreams instead of through
dev controls.

## Rate limiters

The rate-limit bindings are a wrapped-binding shim that asks the control server. Every key is
unlimited unless a test claims it:

```ts
await context.setExtraHTTPHeaders({ "cf-connecting-ip": "203.0.113.7" });
await upstreams.rateLimits.limit("SHARE_CREATE_RATE_LIMITER", "203.0.113.7", 0);
```

Cobalt session limits are keyed by the `tagium_client_id` cookie, so set that cookie on the
context to target one test's session.

## Analytics

The build sets `VITE_PUBLIC_POSTHOG_KEY` and `VITE_PUBLIC_POSTHOG_HOST=https://posthog.e2e.test`,
so the real posthog-js client runs in every test. `fakes/posthog.ts` answers its config, flags and
static requests and decodes captured batches (gzip, base64 or plain JSON) into the call log, owned
by the test whose page sent them. Read them with `upstreams.analyticsEvents()` and poll, since the
client batches sends.

PostHog drops events from browsers that look automated, so the sandbox hides
`navigator.webdriver` and headless `navigator.userAgentData`. A test that needs analytics down can
`page.route("https://posthog.e2e.test/**", (route) => route.abort())`.

## Iterating

- `bun run test:e2e:serve` keeps the harness running, and Playwright reuses it outside CI.
  `E2E_SKIP_BUILD=1` reuses the existing `.output/`.
- Worker logs go to `$TMPDIR/tagium-e2e-harness-<port>.log`.
- To regenerate the audio fixtures, run
  `FFMPEG=/path/to/ffmpeg node tests/e2e/fixtures/generate.ts`. The output is bit-exact.

## Video, posts and stalled media

The fake Cobalt follows Cobalt's forced local-processing rules for tagium save requests:

- YouTube scenarios carry `video` streams (default `h264-1080`, `h264-720`, `h264-480`; also
  `vp9-720`, `av1-720`). `downloadMode: "auto"` returns a `merge` plan (video + audio tunnels),
  `"mute"` a `proxy` plan with the video tunnel only. The codec falls back av1 ↔ vp9 → h264, the
  quality is the best stream at or below the request, and the filename is Cobalt's `pretty` style,
  e.g. `Title - Author (720p, vp9, youtube).webm`. VP9/AV1 merges use WebM Opus audio.
- Audio-only YouTube requests use the vp9 path like Cobalt: with a vp9/av1 stream, `audioFormat:
"best"` is a `proxy` plan named `.opus` whose bytes are WebM Opus; with h264 only it stays m4a.
  Explicit formats return an `audio` plan in the requested format.
- `upstreams.picker({ items, audio })` and `upstreams.gifPost({ asset, filename })` register an
  `https://x.com/…/status/…` post. Items are Cobalt tunnels, or direct
  `https://cdn.e2e.test/…` resources (`directFilename`) that exercise the signed direct path.
- `upstreams.youtube.playlist({ missing: true })` serves YouTube's real answer for a missing
  playlist: HTTP 200 with an `ERROR` alert and no playlist metadata. `status` fails the page with
  that HTTP status instead.
- Any other http(s) URL gets a `url:<href>` key, so `cobalt.fail`, `cobalt.respond` and
  `cobalt.plan(url, json)` work for unsupported links too.
- `cobalt.stallTunnel(url, bytes?)` sends the first half (or `bytes`) of the media and then holds the
  connection open until teardown. Outbound responses are streamed to the worker, not buffered.
  A mid-body connection reset is not modeled: Miniflare's custom outbound service closes a failing
  body cleanly, so the worker would see a truncated but complete response.
- `probeMedia(file)` (`support/media.ts`) runs ffprobe from the app's libav.js build in Node and
  decodes every frame it can (no VP9 decoder, so VP9 reports packets only).
