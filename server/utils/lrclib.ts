import { Data, Duration, Effect, Match, Schedule, Schema } from "effect";

const LRCLIB_ORIGIN = "https://lrclib.net";

const LRCLIB_CLIENT = "tagium (https://tagium.app)";

const DURATION_TOLERANCE_SECONDS = 2;

const MAX_DURATION_SECONDS = 3600;

const BUSY_RETRIES = 2;

const MAX_BUSY_WAIT_SECONDS = 5;

export interface LrclibCredentials {
  appId: string;
  apiKey: string;
}

export interface LyricsQuery {
  title: string;
  artist: string;
  album?: string | undefined;
  duration: number;
}

export type LyricsLookup =
  | { status: "found"; lyrics: string; synced: boolean }
  | { status: "instrumental" }
  | { status: "missing" };

export class LrclibBusyError extends Data.TaggedError("LrclibBusyError")<{
  readonly retryAfterSeconds: number;
  readonly cause?: unknown;
}> {}

export class LrclibRequestError extends Data.TaggedError("LrclibRequestError")<{
  readonly status?: number;
  readonly cause?: unknown;
}> {}

const recordSchema = Schema.Struct({
  duration: Schema.Finite,
  instrumental: Schema.Boolean,
  plainLyrics: Schema.NullOr(Schema.String),
  syncedLyrics: Schema.NullOr(Schema.String),
});

type LrclibRecord = Schema.Schema.Type<typeof recordSchema>;

const decodeRecord = Schema.decodeUnknownEffect(recordSchema);

const decodeRecords = Schema.decodeUnknownEffect(Schema.Array(recordSchema));

const retryAfterSeconds = (response: Response) => {
  const seconds = Number(response.headers.get("retry-after"));

  return Number.isFinite(seconds) && seconds > 0 ? seconds : 1;
};

const requestJson = (credentials: LrclibCredentials, path: string, params: URLSearchParams) =>
  Effect.gen(function* () {
    const url = new URL(path, LRCLIB_ORIGIN);
    url.search = params.toString();

    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(url, {
          signal,
          headers: {
            Accept: "application/json",
            "User-Agent": LRCLIB_CLIENT,
            "Lrclib-App-Id": credentials.appId,
            "Lrclib-Api-Key": credentials.apiKey,
          },
        }),
      catch: (cause) => new LrclibBusyError({ retryAfterSeconds: 1, cause }),
    });

    if (response.status === 404) {
      void response.body?.cancel().catch(() => {});

      return undefined;
    }

    if (response.status === 429 || response.status === 503) {
      void response.body?.cancel().catch(() => {});

      return yield* new LrclibBusyError({ retryAfterSeconds: retryAfterSeconds(response) });
    }

    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
      void response.body?.cancel().catch(() => {});

      return yield* new LrclibRequestError({ status: response.status });
    }

    return yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) => new LrclibRequestError({ status: response.status, cause }),
    });
  }).pipe(
    Effect.retry({
      while: (error) =>
        error instanceof LrclibBusyError && error.retryAfterSeconds <= MAX_BUSY_WAIT_SECONDS,
      schedule: Schedule.recurs(BUSY_RETRIES).pipe(
        Schedule.addDelay(({ input }) =>
          Effect.succeed(
            Duration.millis(
              (input instanceof LrclibBusyError ? input.retryAfterSeconds : 1) *
                1000 *
                (1 + Math.random() * 0.3),
            ),
          ),
        ),
      ),
    }),
  );

const toLookup = (record: LrclibRecord): LyricsLookup => {
  if (record.instrumental) return { status: "instrumental" };

  const synced = record.syncedLyrics?.trim();

  if (synced) return { status: "found", lyrics: synced, synced: true };

  const plain = record.plainLyrics?.trim();

  return plain ? { status: "found", lyrics: plain, synced: false } : { status: "missing" };
};

const lookupRank = Match.type<LyricsLookup>().pipe(
  Match.when({ status: "found", synced: true }, () => 0),
  Match.when({ status: "found" }, () => 1),
  Match.when({ status: "instrumental" }, () => 2),
  Match.when({ status: "missing" }, () => 3),
  Match.exhaustive,
);

export const pickSearchResult = (
  records: readonly LrclibRecord[],
  duration: number,
): LyricsLookup =>
  records
    .flatMap((record) =>
      Math.abs(record.duration - duration) <= DURATION_TOLERANCE_SECONDS ? [toLookup(record)] : [],
    )
    .sort((first, second) => lookupRank(first) - lookupRank(second))[0] ?? { status: "missing" };

export const lookupLyrics = (credentials: LrclibCredentials, query: LyricsQuery) =>
  Effect.gen(function* () {
    const duration = Math.round(query.duration);

    if (duration >= 1 && duration <= MAX_DURATION_SECONDS) {
      const params = new URLSearchParams({
        track_name: query.title,
        artist_name: query.artist,
        duration: String(duration),
      });

      if (query.album) params.set("album_name", query.album);

      const exact = yield* requestJson(credentials, "/api/get", params);

      if (exact !== undefined) {
        return toLookup(
          yield* decodeRecord(exact).pipe(
            Effect.mapError((cause) => new LrclibRequestError({ cause })),
          ),
        );
      }
    }

    const results = yield* requestJson(
      credentials,
      "/api/search",
      new URLSearchParams({ track_name: query.title, artist_name: query.artist }),
    );

    if (results === undefined) return { status: "missing" } satisfies LyricsLookup;

    const records = yield* decodeRecords(results).pipe(
      Effect.mapError((cause) => new LrclibRequestError({ cause })),
    );

    return pickSearchResult(records, query.duration);
  });
