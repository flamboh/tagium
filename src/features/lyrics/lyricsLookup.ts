import { Data, Duration, Effect, Schedule, Schema } from "effect";
import { suggestTitleCleanup } from "@/features/library/metadataCleanup";
import type { AudioMetadata } from "@/features/library/types";

const BUSY_RETRIES = 4;

const MAX_RETRY_AFTER_SECONDS = 60;

const lyricsLookupSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("found"), lyrics: Schema.String, synced: Schema.Boolean }),
  Schema.Struct({ status: Schema.Literal("instrumental") }),
  Schema.Struct({ status: Schema.Literal("missing") }),
]);

export type LyricsLookup = Schema.Schema.Type<typeof lyricsLookupSchema>;

const decodeLyricsLookup = Schema.decodeUnknownEffect(lyricsLookupSchema);

export interface LyricsQuery {
  title: string;
  artist: string;
  album?: string;
  duration: number;
}

class LyricsBusyError extends Data.TaggedError("LyricsBusyError")<{
  readonly retryAfterSeconds: number;
}> {}

class LyricsLookupError extends Data.TaggedError("LyricsLookupError")<{
  readonly status?: number;
  readonly cause?: unknown;
}> {}

const sameText = (first: string, second: string) =>
  first.trim().toLocaleLowerCase() === second.trim().toLocaleLowerCase();

export const getLyricsQuery = (
  metadata: Pick<AudioMetadata, "title" | "artist" | "album" | "duration">,
): LyricsQuery => {
  const artist = metadata.artist.trim();
  const title = suggestTitleCleanup(metadata.title, [artist])?.afterTitle ?? metadata.title.trim();
  const album = metadata.album.trim();

  return album && !sameText(album, metadata.title) && !sameText(album, title)
    ? { title, artist, album, duration: metadata.duration }
    : { title, artist, duration: metadata.duration };
};

const retryAfterSeconds = (response: Response) => {
  const seconds = Number(response.headers.get("retry-after"));

  return Number.isFinite(seconds) && seconds > 0 ? seconds : 2;
};

export const lookupLyrics = (query: LyricsQuery) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetch("/api/lyrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(query),
          signal,
        }),
      catch: (cause) => new LyricsLookupError({ cause }),
    });

    if (response.status === 429 || response.status === 503) {
      return yield* new LyricsBusyError({ retryAfterSeconds: retryAfterSeconds(response) });
    }

    if (!response.ok) return yield* new LyricsLookupError({ status: response.status });

    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) => new LyricsLookupError({ status: response.status, cause }),
    });

    return yield* decodeLyricsLookup(body).pipe(
      Effect.mapError((cause) => new LyricsLookupError({ status: response.status, cause })),
    );
  }).pipe(
    Effect.retry({
      while: (error) =>
        error instanceof LyricsBusyError && error.retryAfterSeconds <= MAX_RETRY_AFTER_SECONDS,
      schedule: Schedule.recurs(BUSY_RETRIES).pipe(
        Schedule.addDelay(({ input }) =>
          Effect.succeed(
            Duration.seconds(input instanceof LyricsBusyError ? input.retryAfterSeconds : 2),
          ),
        ),
      ),
    }),
  );
