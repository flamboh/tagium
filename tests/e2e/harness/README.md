# e2e harness

`bun run test:e2e` builds the app once (`vp build` with share links on), then runs the built
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

## Iterating

- `bun run test:e2e:serve` keeps the harness running, and Playwright reuses it outside CI.
  `E2E_SKIP_BUILD=1` reuses the existing `.output/`.
- Worker logs go to `$TMPDIR/tagium-e2e-harness-<port>.log`.
- To regenerate the audio fixtures, run
  `FFMPEG=/path/to/ffmpeg node tests/e2e/fixtures/generate.ts`. The output is bit-exact.
