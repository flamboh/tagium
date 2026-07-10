import { Effect, Schema } from "effect";
import { AudioDecodeError, toPublicAudioError } from "./audioErrors";
import { runAudioEffectWithoutServices } from "./audioRuntime";
import type { ImportedAlbumMetadata } from "./types";

const urlStringSchema = Schema.String.pipe(
  Schema.refine((value): value is string => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }),
);

const playlistTrackSchema = Schema.Struct({
  title: Schema.String,
  url: urlStringSchema,
  duration: Schema.optionalKey(Schema.Number),
  trackNumber: Schema.Number,
});

const playlistSchema = Schema.Struct({
  title: Schema.String,
  artist: Schema.String,
  genre: Schema.String,
  year: Schema.optionalKey(Schema.Number),
  isAlbum: Schema.Boolean,
  coverUrl: Schema.optionalKey(Schema.String),
  tracks: Schema.Array(playlistTrackSchema),
});

const decodePlaylistEffect = Schema.decodeUnknownEffect(playlistSchema);

export type Playlist = Schema.Schema.Type<typeof playlistSchema>;

export const decodePlaylist = async (input: unknown, providerName: string) => {
  try {
    return await runAudioEffectWithoutServices(
      decodePlaylistEffect(input).pipe(
        Effect.mapError(
          (cause) =>
            new AudioDecodeError({
              message: `malformed ${providerName} playlist response.`,
              cause,
            }),
        ),
      ),
    );
  } catch (error) {
    throw toPublicAudioError(error);
  }
};

export const toImportedAlbumMetadata = (playlist: Playlist): ImportedAlbumMetadata => ({
  title: playlist.title,
  artist: playlist.artist,
  genre: playlist.genre,
  year: playlist.year,
  coverUrl: playlist.coverUrl,
});
