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

Preview deployments should leave `COBALT_ALLOWED_ORIGIN` unset so each preview URL can use the same-origin fallback.
Production can set `COBALT_ALLOWED_ORIGIN` to the final public Tagium origin once the domain is fixed.

## Fly scaling

Cobalt tunnel URLs are process-local. On Fly, a Cobalt API response from one Machine can point at a tunnel served only by that same Machine.

The Fly wrapper makes machine affinity deployable by emitting `X-Cobalt-Machine-Id` on Cobalt API responses.
Tagium can use that value to send follow-up tunnel requests with `Fly-Force-Instance-Id`.

Do not scale Cobalt past one Machine unless one of these is true:

- A Cobalt wrapper or middleware emits `X-Cobalt-Machine-Id` on Cobalt API responses, sourced from Fly's `FLY_MACHINE_ID`, so Tagium can route follow-up tunnel requests back to that Machine.
- Durable artifact storage exists, so tunnel URLs no longer depend on the originating process.

If the wrapper is absent, keep `tagium-cobalt` to a single Machine.
