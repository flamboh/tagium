# Tagium

simple mp3tag editing for music fans

## Cobalt audio downloads

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
The Tagium proxy enforces same-origin browser requests and limits each client to 120 download requests per minute.
