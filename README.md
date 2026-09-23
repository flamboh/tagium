<div>
  <p align="center">
    <img src="public/icon-512.png" alt="" width="128" height="128" />
  </p>

  <h1 align="center">Tagium</h1>

  <p align="center">
    Local, lossless metadata editing for MP3, FLAC, M4A, and Opus audio files. <br>
    Bring your favorite tracks anywhere you listen.
    <br />
    <a href="https://tagium.app">tagium.app</a>
  </p>
</div>

## Using it

Drop audio files onto the page, or paste a YouTube or SoundCloud link to save a track,
playlist, or album.

## How it works

Tagium is a React app powered by [Cobalt](https://cobalt.tools)'s
download API, and a custom metadata engine.

Cobalt runs as our own deployment on Fly and is used strictly as a proxy, it hands back raw
audio, and your browser does the rest. Downloads are never stored.

The metadata engine reads and rewrites tags in the browser, one driver per format. It writes
new tags in around the audio rather than re-encoding, so tag editing is always lossless.

More docs in [docs/](./docs)

## Development

Bun and Node 24 (see `.node-version`). Vite+ (`vp`) drives dev, build, lint, and test.

```sh
bun install
bun run dev        # app + api routes together
bun run test       # unit + server tests
bun run test:e2e   # playwright
bun run typecheck
bun run lint
```

URL imports need a Cobalt instance. Point `COBALT_API_URL` at one, or run a local checkout
with `bun run dev:cobalt`. Share links stay off unless `VITE_PUBLIC_SHARE_LINKS_ENABLED=true`
and their Cloudflare bindings are present.

Deploys go through Cloudflare Workers Builds; `bun run deploy:preview` and
`deploy:production` exist for manual uploads.

Isolated preview stages are declared in `alchemy.run.ts`. Each stage gets its own Worker, D1
database, and R2 bucket on a workers.dev URL, plus its own Cobalt Fly app,
`tagium-cobalt-<stage>`, with a per-stage API key. Stage names must fit that 30-character Fly app
name. Deploying needs Bun 1.4.2, Docker, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, an
org-scoped `FLY_API_TOKEN`, and `FLY_ORG`. The Cobalt image builds from production's pinned base
in `registry.fly.io`, so log Docker in first:

```sh
echo "$FLY_API_TOKEN" | docker login registry.fly.io -u x --password-stdin
bun run alchemy:deploy --stage dev-yourname
bun run alchemy:destroy --stage dev-yourname
```

Pull requests deploy to `pr-<number>` once the `ALCHEMY_PREVIEWS` repository variable is `true`,
using the `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `FLY_PREVIEW_API_TOKEN` secrets and
the `FLY_ORG` variable.
The `prod` and `production` stages are refused.

## License

AGPL-3.0-only.
