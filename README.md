# Tagium

Local, lossless metadata editing for MP3, FLAC, and M4A music files.

[Open Tagium](https://tagium.app)

## Using it

Drop audio files onto the page, or paste a YouTube or SoundCloud link to save a track,
playlist, or set.

From there:

- **Edit a track.** Title, artist, track number, genre, cover art, and the filename it will
  export as.
- **Edit an album.** Album-level values can be linked so they flow down to every track in the
  album. Unlink one in settings and tracks keep their own value.
- **Export.** Download your library as a zip, tagged and named.
- **Share.** Publish a track or album as a link. The link carries your metadata and artwork —
  never the audio — so whoever opens it can apply your work to their own copy of the music.
  Share links last 90 days, and you can update or stop one at any point.

Your files stay in the browser. Audio is never uploaded anywhere; only your settings and
theme carry over between sessions.

## How it works

Tagium is a React single-page app powered by two things: [Cobalt](https://cobalt.tools)'s
download API, and a custom metadata engine.

Cobalt runs as our own deployment on Fly and is used strictly as a proxy — it hands back raw
audio, and your browser does the rest. Downloads never touch a server that keeps them.

The metadata engine reads and rewrites tags in the browser, one driver per format. It splices
new tags in around the audio rather than re-encoding, so a file comes out the other side with
the same bits it went in with. That's the lossless part.

A small server sits behind the app for the things a browser can't do on its own: reaching
providers, and storing share links on Cloudflare. It deploys as a single Worker.

Deeper notes live in [docs/](./docs) — download topology and scaling in
[cobalt-audio-downloads.md](./docs/cobalt-audio-downloads.md), share-link storage and
takedowns in [share-operations.md](./docs/share-operations.md). `CONTEXT.md` defines the
vocabulary the code uses, which is worth a read before touching share or album metadata.

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

URL imports need a Cobalt instance — point `COBALT_API_URL` at one, or run a local checkout
with `bun run dev:cobalt`. Share links stay off unless `VITE_PUBLIC_SHARE_LINKS_ENABLED=true`
and their Cloudflare bindings are present.

Deploys go through Cloudflare Workers Builds; `bun run deploy:preview` and
`deploy:production` exist for manual uploads.

## License

AGPL-3.0-only.
