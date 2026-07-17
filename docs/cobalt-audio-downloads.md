# Cobalt audio downloads

Run a self-hosted Cobalt API instance and expose its URL to the Tagium server:

```sh
pnpm --dir ../oss/cobalt install
bun run dev:cobalt
COBALT_API_URL=http://localhost:9000/ bun dev
```

Tagium requests MP3 audio through its own `/api/cobalt/audio` endpoint, which calls Cobalt server-side and streams the file back to the browser.
SoundCloud set URLs are resolved by Tagium, downloaded track-by-track through Cobalt, then imported as one album.

For production, deploy Cobalt from upstream source and point Tagium at it with `COBALT_API_URL`.
If the Cobalt instance is private, set `COBALT_API_KEY` on Tagium and configure Cobalt API auth for the same key source.
Set `COBALT_ALLOWED_ORIGIN` to the public Tagium origin when the request URL origin differs from the browser origin behind your host.
The Tagium proxy enforces same-origin browser requests and limits each client to 60 download requests per minute.

## Fly deploy

`fly.cobalt.toml` builds `Dockerfile.cobalt`, which layers `cobalt-machine-proxy.mjs` over the pinned Cobalt image.
The wrapper listens on Fly's public internal port `9000`, starts upstream Cobalt on `127.0.0.1:9001`, proxies requests to it, and adds `X-Cobalt-Machine-Id` from `FLY_MACHINE_ID` when Fly provides it.

Deploy Cobalt with:

```sh
flyctl deploy --config fly.cobalt.toml
```

Keep `API_URL` set to the public Cobalt URL in `fly.cobalt.toml`.
Cobalt uses it when generating tunnel URLs, while the wrapper keeps the upstream process on the private secondary port.

## Cloudflare deploy env

`nitro.config.ts` configures the shared Cobalt API URL in Nitro's generated Wrangler config:

```sh
COBALT_API_URL=https://tagium-cobalt.fly.dev/
```

Set the API key as a Cloudflare secret, not in git:

```sh
wrangler secret put COBALT_API_KEY
```

If Cobalt emits `X-Cobalt-Machine-Id`, Tagium signs machine-bound tunnel URLs. Set the signing key as a Cloudflare secret:

```sh
wrangler secret put COBALT_MACHINE_AFFINITY_SECRET
```

The canonical production origin is `https://tagium.app`. `nitro.config.ts` manages its Cloudflare
custom domain along with permanent redirects from `https://www.tagium.app` and
`https://tagium.oli.boo`. Keep `COBALT_ALLOWED_ORIGIN` unset: production requests are already
same-origin, and the request-origin fallback lets isolated preview URLs use Cobalt without
masquerading as production.

## Fly scaling

Cobalt tunnel URLs are process-local. On Fly, a Cobalt API response from one Machine can point at a tunnel served only by that same Machine.

The Fly wrapper makes machine affinity deployable by emitting `X-Cobalt-Machine-Id` on Cobalt API responses.
Tagium can use that value to send follow-up tunnel requests with `Fly-Force-Instance-Id`.

Do not scale Cobalt past one Machine unless one of these is true:

- A Cobalt wrapper or middleware emits `X-Cobalt-Machine-Id` on Cobalt API responses, sourced from Fly's `FLY_MACHINE_ID`, so Tagium can route follow-up tunnel requests back to that Machine.
- Durable artifact storage exists, so tunnel URLs no longer depend on the originating process.

If the wrapper is absent, keep `tagium-cobalt` to a single Machine.

## Load testing

`bun run load-test:cobalt -- --target <cobalt-origin>` (`scripts/load-test-cobalt.ts`) finds the concurrency ceiling of a single Cobalt Machine by requesting real downloads at increasing concurrency and reporting latency/error rate per wave.

By default it cycles through `scripts/load-test-urls.txt`, a curated list of stable, openly-licensed content (Big Buck Bunny, NoCopyrightSounds releases, and similar) chosen to be safe to fetch repeatedly without provider or legal risk. Add more lines there as you find good sources, or point at a different set with `--urls-file <path>` / `--url <url,url,...>`. Prefer diverse sources over hammering one URL — it better matches real traffic and looks less like abuse to the source site.

Never point it at `tagium-cobalt.fly.dev`. Deploy a disposable clone first:

```sh
flyctl apps create tagium-cobalt-loadtest
flyctl deploy --config fly.cobalt.toml --app tagium-cobalt-loadtest
bun run load-test:cobalt -- --target https://tagium-cobalt-loadtest.fly.dev
flyctl apps destroy tagium-cobalt-loadtest
```

Watch `flyctl machine status` or the Fly dashboard for CPU/memory while a wave runs, and correlate spikes with where latency or error rate climbs in the script's output. Destroy the disposable app when finished; a suspended Machine costs nothing but a running one bills per second.

See `docs/cobalt-load-test-2026-07-07.html` for a full run of this test against a disposable clone, including the concurrency ceiling found and a discovery that Cobalt's own default rate limiter (not Fly Machine hardware) is the actual current bottleneck.

## Cobalt native rate limits

Production sets Cobalt's native request-rate limits above the proxy's expected healthy burst envelope:

- `RATELIMIT_WINDOW=60` / `RATELIMIT_MAX=1000` for `POST /` resolve calls.
- `TUNNEL_RATELIMIT_WINDOW=60` / `TUNNEL_RATELIMIT_MAX=2000` for `GET /tunnel` calls.

These are not per browser user. Cobalt keys `POST /` by API key/session when present, otherwise by the client IP it sees; `GET /tunnel` is keyed by the client IP it sees. Since Tagium calls Cobalt through server/Worker infrastructure, many browser users can share one Cobalt-observed caller identity. Keep these native limits as abuse backstops and use the proxy concurrency gate below for real Machine capacity control.

## Proxy concurrency gate

`cobalt-machine-proxy.mjs` caps how many requests it will forward to upstream Cobalt at once, separately for `POST /` (resolve) and `GET /tunnel`, since a real download issues one resolve call plus one or two tunnel fetches (audio, and usually cover art) run concurrently - see `src/features/import/localAudioProcessor.ts`. Requests over the cap queue briefly; once the queue is also full (or a queued request waits too long), the proxy returns a fast `503` (Cobalt-shaped error JSON, status `error.api.capacity_exceeded`) instead of letting requests pile up on a single shared vCPU until everything times out.

Defaults, all overridable via env vars on the Fly app:

- `PROXY_MAX_CONCURRENT_RESOLVE` (24) / `PROXY_MAX_CONCURRENT_TUNNEL` (48) - concurrent requests forwarded to Cobalt.
- `PROXY_MAX_QUEUED_RESOLVE` (96) / `PROXY_MAX_QUEUED_TUNNEL` (192) - how many more can wait before getting an immediate `503`.
- `PROXY_MAX_QUEUE_WAIT_MS` (30000) - how long a queued request waits before it gets a `503` instead of a slot.

The app already has user-visible queueing for playlist work and browser-local Cobalt download slots. That queue is where ETA and cancel affordances belong. The proxy queue is a hidden Machine backstop for many users or sessions arriving at once; it should absorb short shared bursts, then fail fast before the single Cobalt Machine builds a multi-minute backlog.

These defaults come from `docs/cobalt-load-test-2026-07-07.html`, corrected for the audio+cover tunnel pattern real downloads actually use and expanded to tolerate a longer shared burst. Re-tune them if the Machine's spec changes or a follow-up load test says otherwise.
