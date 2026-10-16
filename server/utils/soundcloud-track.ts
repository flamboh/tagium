import { Data, Effect, Option, Schema } from "effect";
import { getSoundCloudClientId } from "./soundcloud";
import { resolveSoundCloudShortLink } from "./soundcloud-link";
import {
  logSoundCloudFailure,
  type SoundCloudLogContext,
  type SoundCloudLogDetails,
} from "./soundcloud-observability";
import { urlStringSchema } from "./schema";
import { parseMediaLink } from "../../src/lib/media-link";

export const SOUNDCLOUD_DURATION_LIMIT_MS = 10_800_000;

const PREFERRED_PRESET = "aac_160k";

const soundCloudShortHosts = new Set(["on.soundcloud.com", "snd.sc"]);

const optionalText = Schema.optionalKey(Schema.NullOr(Schema.String));

const transcodingSchema = Schema.Struct({
  url: urlStringSchema,
  preset: Schema.String,
  snipped: Schema.optionalKey(Schema.Boolean),
  format: Schema.Struct({ protocol: Schema.String }),
});

const decodeTranscoding = Schema.decodeUnknownOption(transcodingSchema);

export type SoundCloudTranscoding = Schema.Schema.Type<typeof transcodingSchema>;

const soundCloudTrackSchema = Schema.Struct({
  title: Schema.String.check(Schema.isNonEmpty()),
  duration: Schema.optionalKey(Schema.Finite),
  artwork_url: Schema.optionalKey(Schema.NullOr(urlStringSchema)),
  genre: optionalText,
  display_date: optionalText,
  license: optionalText,
  policy: Schema.optionalKey(Schema.String),
  track_authorization: Schema.optionalKey(Schema.String),
  publisher_metadata: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        album_title: optionalText,
        writer_composer: optionalText,
      }),
    ),
  ),
  user: Schema.optionalKey(Schema.Struct({ username: Schema.optionalKey(Schema.String) })),
  media: Schema.optionalKey(Schema.Struct({ transcodings: Schema.Array(Schema.Unknown) })),
});

export type SoundCloudTrack = Schema.Schema.Type<typeof soundCloudTrackSchema>;

const streamLocationSchema = Schema.Struct({ url: urlStringSchema });

export class SoundCloudStreamError extends Data.TaggedError("SoundCloudStreamError")<{
  readonly stage: string;
  readonly code: string;
  readonly upstreamStatus?: number;
  readonly cause?: unknown;
}> {}

export interface SoundCloudMediaPlaylist {
  initUrl: string;
  segmentUrls: string[];
  durationMs: number;
}

export interface SoundCloudStream extends SoundCloudMediaPlaylist {
  metadata: Record<string, string>;
  coverUrl: string | null;
}

export const normalizeTrackSourceUrl = async (sourceUrl: string, signal: AbortSignal) => {
  const parsed = parseMediaLink(sourceUrl);

  if (parsed.kind !== "unsupported") return parsed.canonicalUrl;

  const candidate = new URL(sourceUrl);

  if (!soundCloudShortHosts.has(candidate.hostname.toLowerCase())) return sourceUrl;

  return (await resolveSoundCloudShortLink(sourceUrl, { signal })).canonicalUrl;
};

export const isSoundCloudTrackUrl = (sourceUrl: string) => {
  const parsed = parseMediaLink(sourceUrl);

  return parsed.provider === "soundcloud" && parsed.kind === "track";
};

export const soundCloudCoverUrl = (artworkUrl: string | null | undefined) =>
  artworkUrl ? artworkUrl.replace(/-large/, "-t1080x1080") : null;

const errorType = (error: SoundCloudStreamError) =>
  error.cause instanceof Error ? error.cause.name : "UnknownError";

const upstreamDetails = (response: Response): SoundCloudLogDetails => {
  const details: SoundCloudLogDetails = { upstreamStatus: response.status };
  const contentType = response.headers.get("content-type");
  const retryAfter = response.headers.get("retry-after");

  if (contentType) details.contentType = contentType;

  if (retryAfter) details.retryAfter = retryAfter;

  return details;
};

const fail = (
  context: SoundCloudLogContext,
  startedAt: number,
  error: SoundCloudStreamError,
  details: SoundCloudLogDetails = {},
) =>
  Effect.promise(() => logSoundCloudFailure(error.stage, context, details, startedAt)).pipe(
    Effect.andThen(Effect.fail(error)),
  );

const fetchUpstream = <A>(
  url: URL | string,
  options: {
    stage: string;
    code: string;
    context: SoundCloudLogContext;
    read: (response: Response) => Promise<A>;
    parseCode?: string;
    statusCode?: (status: number) => string | undefined;
  },
) =>
  Effect.gen(function* () {
    const { stage, code, context } = options;
    const startedAt = Date.now();

    const parseStage = stage.replace("_fetch", "_parse");
    let reading = false;

    const result = yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(url, { signal });

        if (!response.ok) {
          void response.body?.cancel().catch(() => {});

          return { ok: false as const, response };
        }

        reading = true;

        return { ok: true as const, value: await options.read(response) };
      },
      catch: (cause) =>
        reading
          ? new SoundCloudStreamError({ stage: parseStage, code: options.parseCode ?? code, cause })
          : new SoundCloudStreamError({ stage, code, cause }),
    }).pipe(
      Effect.catchTag("SoundCloudStreamError", (error) =>
        fail(context, startedAt, error, { errorType: errorType(error) }),
      ),
    );

    if (!result.ok) {
      return yield* fail(
        context,
        startedAt,
        new SoundCloudStreamError({
          stage,
          code: options.statusCode?.(result.response.status) ?? code,
          upstreamStatus: result.response.status,
        }),
        upstreamDetails(result.response),
      );
    }

    return result.value;
  });

const decodeJson =
  <S extends Schema.ConstraintDecoder<unknown, never>>(schema: S) =>
  async (response: Response): Promise<S["Type"]> =>
    Effect.runPromise(Schema.decodeUnknownEffect(schema)(await response.json()));

export const resolveSoundCloudTrack = (sourceUrl: string, context: SoundCloudLogContext) =>
  Effect.gen(function* () {
    const clientId = yield* Effect.tryPromise({
      try: (signal) =>
        getSoundCloudClientId(
          (input, init) => globalThis.fetch(input, { ...init, signal }),
          context,
        ),
      catch: (cause) =>
        new SoundCloudStreamError({ stage: "client_id", code: "error.api.fetch.fail", cause }),
    });

    const resolveUrl = new URL("https://api-v2.soundcloud.com/resolve");
    resolveUrl.searchParams.set("url", sourceUrl);
    resolveUrl.searchParams.set("client_id", clientId);

    const track = yield* fetchUpstream(resolveUrl, {
      stage: "track.resolve_fetch",
      code: "error.api.fetch.fail",
      context,
      read: decodeJson(soundCloudTrackSchema),
      statusCode: (status) => (status === 404 ? "error.api.content.post.unavailable" : undefined),
    });

    return { clientId, track };
  });

const isPlayableTranscoding = (entry: SoundCloudTranscoding) =>
  entry.snipped !== true && entry.preset.startsWith("aac_") && entry.format.protocol === "hls";

export const selectSoundCloudTranscoding = (transcodings: readonly unknown[]) => {
  const candidates = transcodings.flatMap((entry) =>
    Option.toArray(decodeTranscoding(entry)).filter(isPlayableTranscoding),
  );

  return candidates.find((entry) => entry.preset === PREFERRED_PRESET) ?? candidates[0];
};

const playlistAttribute = (line: string, name: string) =>
  line
    .match(new RegExp(`(?:^|[:,])${name}=(?:"([^"]*)"|([^,]*))`))
    ?.slice(1)
    .find(Boolean);

export const parseSoundCloudMediaPlaylist = (
  text: string,
  playlistUrl: string,
): Effect.Effect<SoundCloudMediaPlaylist, string> =>
  Effect.gen(function* () {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines[0] !== "#EXTM3U") return yield* Effect.fail("not_m3u8");

    if (lines.some((line) => line.startsWith("#EXT-X-STREAM-INF"))) {
      return yield* Effect.fail("multivariant");
    }

    let initUrl: string | undefined;
    let pendingDuration: number | undefined;
    let durationSeconds = 0;
    const segmentUrls: string[] = [];

    for (const line of lines.slice(1)) {
      if (line.startsWith("#EXT-X-KEY:")) {
        const method = playlistAttribute(line, "METHOD");

        if (method && method !== "NONE") return yield* Effect.fail("encrypted");
        continue;
      }

      if (line.startsWith("#EXT-X-BYTERANGE")) return yield* Effect.fail("byterange");

      if (line === "#EXT-X-DISCONTINUITY") return yield* Effect.fail("discontinuity");

      if (line.startsWith("#EXT-X-MAP:")) {
        if (playlistAttribute(line, "BYTERANGE")) return yield* Effect.fail("byterange");
        const uri = playlistAttribute(line, "URI");

        if (!uri || initUrl) return yield* Effect.fail("init");
        initUrl = new URL(uri, playlistUrl).toString();
        continue;
      }

      if (line.startsWith("#EXTINF:")) {
        const duration = Number.parseFloat(line.slice("#EXTINF:".length));

        if (!Number.isFinite(duration) || duration < 0) return yield* Effect.fail("extinf");
        pendingDuration = duration;
        continue;
      }

      if (line.startsWith("#")) continue;

      if (pendingDuration === undefined) return yield* Effect.fail("segment");
      segmentUrls.push(new URL(line, playlistUrl).toString());
      durationSeconds += pendingDuration;
      pendingDuration = undefined;
    }

    if (!initUrl) return yield* Effect.fail("init");

    if (segmentUrls.length === 0) return yield* Effect.fail("empty");

    return { initUrl, segmentUrls, durationMs: Math.round(durationSeconds * 1000) };
  });

const trimmed = (value: string | null | undefined) => value?.trim() || undefined;

export const soundCloudTrackMetadata = (track: SoundCloudTrack) => {
  const artist = trimmed(track.user?.username);

  const entries = {
    title: trimmed(track.title),
    artist,
    album_artist: artist,
    album: trimmed(track.publisher_metadata?.album_title),
    composer: trimmed(track.publisher_metadata?.writer_composer),
    genre: trimmed(track.genre),
    date: trimmed(track.display_date)?.slice(0, 10),
    copyright: trimmed(track.license),
  };

  const metadata: Record<string, string> = {};

  for (const [key, value] of Object.entries(entries)) if (value) metadata[key] = value;

  return metadata;
};

const policyError = (track: SoundCloudTrack) => {
  if (track.duration !== undefined && track.duration > SOUNDCLOUD_DURATION_LIMIT_MS) {
    return "error.api.content.too_long";
  }

  if (track.policy === "BLOCK") return "error.api.content.region";

  if (track.policy === "SNIP") return "error.api.content.paid";

  return undefined;
};

export const resolveSoundCloudStream = (sourceUrl: string, context: SoundCloudLogContext) =>
  Effect.gen(function* () {
    const { clientId, track } = yield* resolveSoundCloudTrack(sourceUrl, context);
    const blocked = policyError(track);

    if (blocked) return yield* new SoundCloudStreamError({ stage: "track.policy", code: blocked });

    const startedAt = Date.now();
    const transcoding = selectSoundCloudTranscoding(track.media?.transcodings ?? []);

    if (!transcoding || !track.track_authorization) {
      const decoded = (track.media?.transcodings ?? []).flatMap((entry) =>
        Option.toArray(decodeTranscoding(entry)),
      );

      const encryptedOnly =
        decoded.length > 0 && decoded.every((entry) => entry.format.protocol.includes("encrypted"));

      const presets = decoded.map((entry) => `${entry.preset}:${entry.format.protocol}`);

      return yield* fail(
        context,
        startedAt,
        new SoundCloudStreamError({
          stage: "stream.select",
          code: encryptedOnly ? "error.api.soundcloud.maybe_drm" : "error.api.fetch.empty",
        }),
        {
          presets: presets.join(",") || null,
          hasTrackAuthorization: Boolean(track.track_authorization),
        },
      );
    }

    const streamUrl = new URL(transcoding.url);
    streamUrl.searchParams.set("client_id", clientId);
    streamUrl.searchParams.set("track_authorization", track.track_authorization);

    const location = yield* fetchUpstream(streamUrl, {
      stage: "stream.location_fetch",
      code: "error.api.fetch.empty",
      context,
      read: decodeJson(streamLocationSchema),
    });

    const playlistText = yield* fetchUpstream(location.url, {
      stage: "stream.playlist_fetch",
      code: "error.api.fetch.empty",
      context,
      read: (response) => response.text(),
    });

    const playlistStartedAt = Date.now();

    const playlist = yield* parseSoundCloudMediaPlaylist(playlistText, location.url).pipe(
      Effect.catch((reason) =>
        fail(
          context,
          playlistStartedAt,
          new SoundCloudStreamError({
            stage: "stream.playlist_parse",
            code: "error.api.fetch.empty",
          }),
          { reason, preset: transcoding.preset },
        ),
      ),
    );

    return {
      ...playlist,
      metadata: soundCloudTrackMetadata(track),
      coverUrl: soundCloudCoverUrl(track.artwork_url),
    } satisfies SoundCloudStream;
  });
