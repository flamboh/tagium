# Cobalt audio downloads

Tagium sends browser download requests through its own `/api/cobalt/audio` endpoint. The server
uses Cobalt only as a download proxy; metadata processing stays local in the browser. SoundCloud
sets are resolved by Tagium and imported track by track as one album.

## Production topology

`fly.cobalt.toml` deploys the pinned Cobalt image behind `cobalt-machine-proxy.mjs`. The wrapper
listens publicly on port 9000, runs Cobalt on `127.0.0.1:9001`, and adds
`X-Cobalt-Machine-Id` when Fly exposes `FLY_MACHINE_ID`.

Two URLs serve different purposes:

- Cobalt's `API_URL` must be its public Fly URL so generated tunnel URLs are reachable.
- Tagium's `COBALT_API_URL` points the Cloudflare Worker at that Cobalt deployment.

Store `COBALT_API_KEY` and `COBALT_MACHINE_AFFINITY_SECRET` as Cloudflare secrets. The latter signs
machine-bound tunnel URLs before Tagium sends them to a browser. Production requests are
same-origin, so `COBALT_ALLOWED_ORIGIN` should remain unset; this also lets isolated preview URLs
use the same deployment without pretending to be production.

Deploy with:

```sh
flyctl deploy --config fly.cobalt.toml
```

## Scaling invariant

Cobalt tunnel URLs are process-local. A resolve response from one Fly Machine can therefore point
at a tunnel that exists only on that Machine. Do not scale beyond one Machine unless either:

- the wrapper emits `X-Cobalt-Machine-Id` and Tagium can route tunnel requests with
  `Fly-Force-Instance-Id`; or
- tunnel artifacts live in durable shared storage.

Without one of those guarantees, multiple Machines cause intermittent download failures.

## Capacity model

Capacity is intentionally controlled at three layers:

1. The browser queue provides progress, ETA, and cancellation for a user's playlist.
2. The Fly wrapper separately limits resolve and tunnel concurrency, queues short shared bursts,
   and returns a fast Cobalt-shaped `503` when saturated.
3. Cobalt's native rate limits remain high abuse backstops.

Resolve and tunnel limits are separate because one download produces one resolve request plus one
or two tunnel fetches for audio and cover art. Cobalt's native limits are not per Tagium user:
requests arrive through shared server infrastructure and may share the same API-key or IP identity.
Tune the wrapper controls in `fly.cobalt.toml`, not the browser queue, when Machine capacity changes.

## Load testing

Run the checked-in load tester only against a disposable Fly clone:

```sh
flyctl apps create tagium-cobalt-loadtest
flyctl deploy --config fly.cobalt.toml --app tagium-cobalt-loadtest
bun run load-test:cobalt -- --target https://tagium-cobalt-loadtest.fly.dev
flyctl apps destroy tagium-cobalt-loadtest
```

Never target the production Cobalt deployment. The script deliberately exercises real provider
downloads and increasing concurrency; use its curated URL list or an explicitly supplied safe list.
