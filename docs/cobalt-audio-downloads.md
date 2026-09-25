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

## Preview topology

Alchemy preview stages don't share production Cobalt. `alchemy.run.ts` deploys
`tagium-cobalt-<stage>` from `Dockerfile.cobalt` with the same machine settings as
`fly.cobalt.toml`. It deploys blue/green: Alchemy health-checks a new machine set, then cordons
each old machine and waits up to its 300-second SIGTERM drain before destroying it, so in-flight
tunnels finish. Machine ids change on every deploy, which is safe because tunnel URLs never
outlive their Cobalt process. Each stage generates its own Cobalt API key. Cobalt reads it through
`API_KEY_URL` as a `data:` URL, `API_AUTH_REQUIRED=1` rejects unauthenticated requests, and the
Worker gets the same key as `COBALT_API_KEY`. Set `COBALT_MACHINE_COUNT` to deploy more than one
machine, for example to exercise machine affinity.

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
flyctl deploy --config fly.cobalt.toml --app tagium-cobalt-loadtest \
  --env API_URL=https://tagium-cobalt-loadtest.fly.dev/
bun run load-test:cobalt -- --target https://tagium-cobalt-loadtest.fly.dev
flyctl apps destroy tagium-cobalt-loadtest
```

Never target the production Cobalt deployment. The script deliberately exercises real provider
downloads and increasing concurrency; use its curated URL list or an explicitly supplied safe list.
It refuses the production origin and aborts before fetching any tunnel whose origin differs from
the disposable target. Keep the explicit `API_URL` override: without it, the shared production Fly
configuration would make the clone return production tunnel URLs.
