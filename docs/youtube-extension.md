# YouTube extension prototype

Status: **draft experiment, not a verified live YouTube download solution**. No store
submission, deployment, paid resource, proxy, Google account cookies, or Fly machine
operation is part of this work. The existing server route remains the default.

This implements the explicitly requested browser-extension direction (D01/D02 in
`client-side-fetch.md`). The research's opening recommendation also numbers a native
helper first; this draft does not build that helper.

## Try it locally

Use Bun and the repo's Vite+ setup. From the repository root:

```sh
bun install --frozen-lockfile
cd extensions/youtube
bun install --frozen-lockfile
bun run typecheck
bun run build:local
bun run build:local:firefox
cd ../..
bun run dev --host 127.0.0.1 --port 5173 --strictPort
```

- Chrome: open `chrome://extensions`, enable developer mode, choose **load unpacked**,
  and select `extensions/youtube/.output/chrome-mv3-dev`.
- Firefox desktop 140+: open `about:debugging#/runtime/this-firefox`, choose **load
  temporary add-on**, and select `.output/firefox-mv3-dev/manifest.json`. Temporary
  installation disappears on browser restart. Grant the requested host permissions.
- Open **http://localhost:5173**, reload after installing, then choose **connect
  extension**. Use this exact origin; `127.0.0.1`, other ports, subdomains, and preview
  tenants are deliberately not authorized.
- Import a single YouTube URL you have permission to save. Approve that video in the
  newly opened extension tab. Keep both tabs open. Canceling does not try the server.
  Acquisition failure tries the existing server once; processing failure does not.
- **use server** changes future imports back to the existing route. Connection preference
  lasts only for the page session. This draft's UI has not been deployed to tagium.app.

From the root, `bun run test:extension` builds the local Chromium extension and runs
the unpacked Chromium integration test with its own dev server (stop yours first).
It intercepts external requests and serves generated sine audio; it does not test YouTube availability or call production Cobalt.

## Architecture

`AudioBackend` selects the extension for connected YouTube tracks. The website sends
only a video ID. The extension runs both player resolution and media fetching over
the importing device's network. Bytes return to `LocalAudioProcessor`, preserving
format/bitrate, metadata, stable file date, and the existing import/queue identity.
There is no backend tunnel or remote egress dependency in this acquisition path.
Optional server metadata enrichment is deliberately skipped in extension mode so a
slow or blocked metadata server cannot delay local acquisition. This currently loses
server title cleanup, artwork, and enrichment even on server fallback; raw title and
author are retained. Review that tradeoff before merging.

The extension is a separate WXT 0.21.4 package, with its own lockfile and YouTube.js
17.2.0 dependency. Chrome and Firefox builds use Manifest V3. A visible extension
document owns the fetch and consent UI; the background worker only routes messages.
One acquisition runs at a time. The web app queues its own jobs; another browser tab
gets a busy error. No generic URL-fetch or script-execution endpoint is exposed.

## Messaging and lifecycle

1. A top-level content script accepts `tagium-youtube-v1` messages only from its own
   window on `https://tagium.app` (also `http://localhost:5173` in local builds).
2. `ping`/`ready` detects installation. Connecting in the app enables local preference;
   the extension's own **allow this download** button authorizes each network job.
3. `start {id, videoId}` opens a job tab. The background validates sender origin/frame,
   pins the job to the originating port and newly created extension tab, and rejects
   competing jobs. Job IDs and 11-character video IDs are validated.
4. `chunk {id, sequence, data}` carries at most 192 KiB of base64-encoded input bytes.
   The app acknowledges each sequence before the producer continues. Completion must
   match the received byte count. Total audio is capped at 128 MiB.
5. `cancel`, port disconnect, tab closure, and timeout stop work. The app timeout and
   worker timeout are ten minutes; a missing chunk acknowledgement stops the producer
   after 30 seconds. An active visible job sends a message every 20 seconds; idle app
   ports reconnect on demand. Browser restart/suspension is not resumable.

The app buffers the complete source before local processing. Base64 and browser IPC
copy data, so 128 MiB is an input limit, not a peak-memory promise. No audio, token,
signed URL, or cookie is persisted by the extension. A compromised allowed-origin
script can forge page messages: the independent extension approval is the meaningful
user-consent boundary, not the page nonce. The bridge is not a general cross-site API.

## Extraction and PO tokens

This deliberately narrow spike uses an anonymous, locally generated YouTube.js
session and the `IOS` player client. It accepts complete, unencrypted, non-live,
default-track AAC/Opus audio representations with known length. The playback nonce
stays in the extension. Every fetch omits credentials, strips authentication headers,
and rejects redirects; only the player endpoint and Google Video `videoplayback`
endpoints are allowed. No player JavaScript is downloaded or evaluated.

**No PO-token provider is implemented.** This client choice is an experiment, not a
claim of a permanently token-free client. A player response can succeed while media
returns 403. Ciphered URLs, SABR/UMP, HLS, token challenges, and redirects fail closed.
Never send a partial response to libav as if it were complete audio.

The next extraction milestone is a maintained guest-session token/decipher/SABR
adapter, evaluated together with store execution rules. Tokens must be generated and
used with the same local session and correct player/GVS/video binding; never export
them or account cookies to Fly. A bundled interpreter or sandbox does not by itself
establish store compliance. References: [YouTube.js](https://github.com/LuanRT/YouTube.js/blob/main/README.md),
[ytc-bridge](https://github.com/LuanRT/ytc-bridge/blob/main/README.md),
[PO-token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide).

## Permissions and publishing

Host permissions: `https://www.youtube.com/*` for anonymous player requests and
`https://*.googlevideo.com/*` for media. Content scripts match tagium.app and localhost;
runtime checks narrow localhost to port 5173 in local builds. Default production
builds omit localhost entirely; `build:local` opts into it for testing. There are no cookies, history, storage,
downloads, scripting, webRequest, DNR, or all-sites permissions. Tab creation does not
require the sensitive `tabs` permission. No page security headers are changed.

Before any release, use the production build, select permanent IDs, add icons/listing screenshots, provide privacy disclosures and support contact,
audit dependency licenses, include reproducible source/build instructions, and test
each browser's installation/host-permission flow. Store approval is unresolved.

- **Chrome Web Store:** a publisher account has a one-time registration fee; under
  the zero-spend constraint, use unpacked builds unless an existing paid account is
  available. Submission requires a packaged MV3 extension, single-purpose and
  permission justifications, accurate privacy/data disclosures, and reviewable code.
  Remote code/executable logic and intellectual-property policies need review before
  adding a token solver. No blanket approval or blanket rejection is assumed.
  [Registration](https://developer.chrome.com/docs/webstore/register),
  [program policies](https://developer.chrome.com/docs/webstore/program-policies/policies).
- **AMO:** temporary local loading is for development. Normal Firefox distribution
  needs signing, including unlisted self-distribution; provide source and build
  instructions for bundled code. Mozilla's policies apply to unlisted add-ons too.
  The manifest declares browsing activity and website content transmission because
  requested video IDs go to YouTube and audio is handed to Tagium. Validate the final
  taxonomy/privacy statement during review; do not label the extension as collecting
  nothing merely because it has no telemetry.
  [Add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/),
  [signing](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/),
  [built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

## Mobile and remaining scope

Desktop is the prototype target. Stock Chrome Android does not run this desktop
extension. Firefox Android supports extensions, but this build has not been tested
there: tab lifetime, host permissions, memory, and handoff need device verification.
Safari/iOS would require a separate app-packaged extension and policy review. Keep
server imports and file upload available on mobile; do not advertise mobile support.

Playlist enumeration still uses the server and can fail before audio jobs start.
Per-track approval is unsuitable for a large playlist. Artwork, resumable downloads,
session-wide consent, richer progress, language selection, and guest-token/SABR support
are follow-ups. Tagium Save is outside this prototype.

## Measured verification

- App typecheck, production build, Vite+ check (warnings only), and 388 repository tests
  passed; Chrome MV3 and Firefox MV3 production/local packages built and extension
  typecheck passed. A separate CI job checks extension types and production builds.
- Actual unpacked Chromium: installation detection, connection prompt, approval tab,
  and explicit cancel verified. Approval remained usable after a 40-second wait.
- Intercepted Chromium integration test passed: generated AAC audio traveled through
  YouTube.js parsing, the real extension, chunk acknowledgements, and local audio
  processing to a ready track with its title, artist, album, and six-second audio preview.
  No player/media request occurred before approval. Removing the pending track closed
  its job tab and made no server request. A simulated media 403 tried the server once;
  successful fallback retained the single-album setting, and failure showed a useful prompt. This is fixture evidence, not live media.
- One anonymous live Chromium probe of `aqz-KE-bpKQ` (Big Buck Bunny): player HTTP 403,
  no media request, **zero audio bytes**. Fresh browser profile; no account cookies.
- Two Bun probes of the same video: first resolved formats but media returned 403;
  second, with the playback nonce, encountered a rejected redirect. Both downloaded
  zero bytes. These ran from the development machine, not Fly or a representative
  sample of users' connections. They do not establish a success rate.
- Firefox runtime, representative residential-network imports, full-duration live
  audio validation, and store review remain unverified. No production changes occurred.

Review decisions for Oliver: is per-download tab approval acceptable for this spike;
should the next milestone prioritize an anonymous token/SABR adapter or the native
helper baseline; and is an existing Chrome publisher account available without spending?
