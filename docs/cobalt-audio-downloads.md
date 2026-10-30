# Cobalt audio downloads

Tagium sends browser download requests through its own `/api/cobalt/audio` endpoint. The server
uses Cobalt only as a download proxy; metadata processing stays local in the browser. SoundCloud
sets are resolved by Tagium and imported track by track as one album.

The editor doesn't use Cobalt for SoundCloud. `/api/soundcloud-stream` resolves the track and its
`aac_*` HLS playlist on the Worker (api-v2 has no CORS), and the browser downloads the init
segment, media segments and artwork straight from SoundCloud's CDN, which allows any origin. It
joins the fMP4 segments, then remuxes them to m4a or encodes mp3 with the same libav worker.
The playlist URL expires within minutes, so the Worker reads it immediately and returns the
segment URLs, which last about two hours. Tagium Save still downloads SoundCloud through Cobalt,
which is why `cobalt-soundcloud.mjs` and the m4a ffmpeg patch stay in the Cobalt image.

Because SoundCloud downloads never reach Fly, they don't share Cobalt's limits. The browser runs
six SoundCloud downloads at a time (four for Cobalt), with its own slot pool and no tunnel-start
spacing, and `/api/soundcloud-stream` uses `SOUNDCLOUD_SESSION_RATE_LIMITER` (60/min) and
`SOUNDCLOUD_CLIENT_RATE_LIMITER` (120/min) instead of the Cobalt limiters.

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

### YouTube hardening experiment (2026-10-24)

This change is **not ready to deploy**. The isolated comparison below found a regression on one
of two public YouTube samples. Do not merge merely because CI is green: merging these files into
`main` automatically runs the production Cobalt deployment. Production Machine `080336df2d36e8`
was not modified, restarted, stopped, cloned, or destroyed during this experiment. Never destroy
that Machine as a response to an IP block.

The pinned base is Cobalt 11.7.1 at
[`df90872`](https://github.com/imputnet/cobalt/commit/df90872a17c751f9967d1e55174f0369901f65e2),
Node 24.22.1, with YouTube.js 17.0.1. Its audio route already consumes
`YOUTUBE_GENERATE_PO_TOKENS=1`; the older `.repos/cobalt` reference does not accurately describe
that image. The base mints a visitor token, caches its minter for six hours, and marks bot
rejections retryable. Cobalt's resolver can consequently make five immediate attempts.

`cobalt-patch-youtube.mjs` now patches that exact base at build time. Every replacement checks its
expected occurrence count and fails the build if the source changes. Nothing in `.repos` is edited.
The small `cobalt-youtube` runtime has its own npm lockfile; Docker installs it with `npm ci` and
lifecycle scripts disabled. Its dependencies do not enter Tagium's browser bundle.

- **Current audio client:** YouTube.js 18.3.0 uses `MWEB`. The mobile watch page supplies the actual
  client version, visitor context, player identifier, and token-binding experiment flags. A consent
  page or incomplete context fails explicitly instead of inventing a visitor. The observed version
  on October 24 was `2.20261022.04.00`.
- **Automatic tokens:** BgUtils 4.0.3 and JSDOM mint a video-bound player token. Media uses a
  video-bound token when the served `html5_generate_content_po_token` flag is enabled, otherwise
  a token bound to that session's visitor. The media URL receives `pot`. No account cookies,
  manually supplied tokens, paid proxies, or external token server are used. A reusable minter
  expires according to its reported TTL minus its refresh threshold, capped at 15 minutes;
  sessions also refresh after 15 minutes. Each request clones the session with its own abortable
  transport. Rejected sessions are discarded, and cleanup failures cannot crash Node.
- **Shared pacing:** all YouTube resolves on one Cobalt process, including video resolves and
  tunnel refreshes, share one Effect semaphore. Resolve starts are at least 5 seconds apart,
  including retries. At most four requests are admitted (one active plus three waiting), with a
  20-second queue deadline and a 20-second deadline per attempt. Only transient `fetch.fail`
  results receive a second attempt. The old recursive retry flag is removed. These limits govern
  resolves; the HTTP calls within one resolve and media chunks are not individually paced.
- **Rejection handling:** login/bot and recognized `fetch.rate` errors open a five-minute
  process-wide circuit, including 429s observed by the audio transport and media probe. The existing
  non-audio implementation does not classify every HTTP 429 this way.
  Queued users also stop without contacting YouTube. A media HEAD returning 403 suppresses only
  that video for five minutes, so an unavailable track does not disable other tracks. That cache
  holds at most 64 IDs. Media 403/429 also discard the audio session/minter. No tokens, visitor
  identities, or media URLs are logged.
- **Complete download contract:** audio formats, tags, covers, browser conversion and the existing
  machine-affine tunnels remain Cobalt's responsibility. Audio formats without a direct or ciphered URL are rejected explicitly; this adapter does not
  implement SABR streaming. Before issuing an audio tunnel, the new
  path checks that the signed media URL returns 200 and a positive finite content length. This
  catches an observed 403 that Cobalt otherwise turned into a 200 response with zero audio bytes.
  Audio tunnels no longer automatically re-resolve on media rejection; an interrupted or expired
  tunnel must be resolved again through the bounded scheduler. A HEAD success is still not proof
  that the complete download will succeed.

`CUSTOM_INNERTUBE_CLIENT=TV_SIMPLY` and `YOUTUBE_GENERATE_PO_TOKENS=1` remain the settings for the
existing non-audio implementation. They do not select the new audio client. Both routes share the
YouTube budget. SoundCloud and other services keep their existing paths and wrapper capacity.

This budget is shared across users of **one process**, not across Machines. Keep one Machine for
this experiment. Increasing `COBALT_MACHINE_COUNT` multiplies the budget and requires an external
shared limiter if the Machines share an egress identity. Client disconnects are not propagated
through Cobalt's existing service interface; admitted work is bounded by the server deadlines.

The integration follows the current
[PO-token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide),
[yt-dlp's context-dependent binding logic](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_video.py),
and [BgUtils' token example](https://github.com/LuanRT/BgUtils/blob/f842f8a14435a35800ff469d315bb1a7e6d7a64a/examples/index.ts).
Token generation does not establish that YouTube trusts the runtime or egress.

### Why FREEBIND_CIDR is not configured on Fly

Verified against Fly's current official documentation on October 24, 2026:

- [Fly's May 19 networking change](https://fly.io/changelog/machines-ipv6-nat/) says Machines now
  have private 6PN IPv6 addresses, with outbound IPv6 SNATed to the host's public IPv6. An app's
  public ingress IPv6 is handled by Fly Proxy; it is not a routed prefix delegated to the Machine.
- [Static egress documentation](https://docs.fly.io/networking/egress-ips) offers individual
  regional IPv4/IPv6 address pairs. It does not offer an arbitrary routed public /64 to a Machine,
  and static egress costs extra.

Cobalt freebind can choose source addresses inside an **already routed and authorized** prefix.
It cannot allocate a prefix, bypass Fly's SNAT, or make replies to invented addresses routable.
Neither the 6PN subnet nor the app's public ingress address supplies the required public prefix.
Therefore `FREEBIND_CIDR` is infeasible on the documented default Fly topology and is skipped.
No production socket/freebind experiment was run and no IPs, tunnels or gateways were purchased.
The new audio path rejects per-request source-IP rotation rather than reusing an attestation
session across unverified egress changes. An independently routed host would require separate
session/address-affinity work and validation.

### Isolated measurements and merge gate

Two local Docker containers used the same pinned base and Tagium overlays, each limited to one
CPU and 1 GiB RAM, with localhost-only ports and no production credentials. Both reported egress
`69.9.132.149`; this was the workspace host, **not Fly's production egress**. The inputs were the
existing live-smoke sample `jNQXAC9IVRw` and load-test sample `YE7VzlLtp-4`, with
`downloadMode: "audio"`, `audioFormat: "best"`, and `localProcessing: "forced"`.
Requests were sequential with at least five seconds between resolves. This is a tiny functional
comparison, not a load test or a durability measurement.

| Sample        | Baseline resolve | Baseline complete audio               | New served-context resolve | New complete audio                         |
| ------------- | ---------------: | ------------------------------------- | -------------------------: | ------------------------------------------ |
| `jNQXAC9IVRw` |  9,713 ms (cold) | 255,427 bytes; 19.021 s; WebM/Opus    |            5,328 ms (cold) | 255,427 bytes; 19.021 s; WebM/Opus         |
| `YE7VzlLtp-4` |    404 ms (warm) | 9,802,222 bytes; 596.501 s; WebM/Opus |              537 ms (warm) | resolve failed with `error.api.fetch.fail` |

Both short audio files have the same SHA-256:
`f9884de69a8447dafa84219297e282eabcc62bdc0f38a8a9a3a7cfa23ce2c05b`.
The baseline completed **2/2** samples; the new route completed **1/2**. The first implementation,
before the served-context and media-probe corrections, also completed only 1/2: its long-sample
tunnel returned HTTP 200 with **0 bytes** after 15,084 ms. A separate local diagnostic observed a
403 for a video-bound media token. These observations do not establish whether the remaining
failure is attestation trust, media format/client compatibility, or another YouTube experiment.

A subsequent fresh-container repeat on the reviewed build completed **0/3** YouTube requests:
short, long, then short again all returned `error.api.fetch.fail` in 5,167 / 5,271 / 5,211 ms.
A direct diagnostic then threw `No valid URL to decipher`. The final patch consequently filters
formats without a direct/ciphered URL instead of treating that compatibility error as transient.
The earlier 1/2 result is not a success-rate estimate or a passing final smoke test. This variation
is another reason to leave the change unmerged; implementing a SABR transport may be necessary,
but these results alone do not prove that diagnosis.

SoundCloud's `forss/introitus` completed on the changed container: resolve 1,070 ms, download
2,973 ms, HTTP 200, 1,613,935 bytes, m4a, 98.499 seconds according to ffprobe. A single idle-memory
snapshot of the earlier comparison showed 123 MiB baseline versus 320.6 MiB changed; these are
not peak-memory measurements.

Automated tests exercise a four-user burst with 5,000 ms spacing and fifth-request rejection,
shared login/rate cooldown including queued callers, thrown 429 errors, video-specific media
rejection, at most two transient attempts, aborting stalled work, queue expiry, and mobile-context
parsing. These are deterministic tests, not measurements of requests to YouTube. CI runs these
and installs the locked runtime dependencies, but does not authenticate to Fly or build the Cobalt
image on pull requests. The Docker build and provider smoke are separate local verification.

No Fly staging resources were created. Fly's current
[free trial](https://docs.fly.io/about/free-trial) is limited to two VM hours or seven days;
there is no verified unused free allowance for this existing account. Creating a staging Machine
without that evidence would violate the zero-spend constraint. Nothing needs tearing down on Fly.

**Leave the PR open.** Before merging, obtain a genuinely no-cost nonproduction egress setup,
repeat full short/long audio and SoundCloud downloads, verify decoding/duration and retry/cooldown
behaviour, and run a sustained observation beyond the reported five-hour failure window. CI must
pass on the exact head, and live results must show no regression. No five-hour durability result,
Fly unblock, browser end-to-end success, or production improvement is claimed here.

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

Run the checked-in load tester only against a disposable Fly clone, after independently verifying
that the account has enough unused free allowance. Do not create paid resources for this experiment:

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
