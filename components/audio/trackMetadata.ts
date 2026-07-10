import { Effect, Schema } from "effect";
import { AudioDecodeError, toPublicAudioError } from "./audioErrors";
import { runAudioEffectWithoutServices } from "./audioRuntime";

const trackMetadataSchema = Schema.Struct({
  title: Schema.String,
  artist: Schema.String,
  coverUrl: Schema.optionalKey(Schema.String),
});

const decodeTrackMetadataEffect = Schema.decodeUnknownEffect(trackMetadataSchema);

export type TrackMetadata = Schema.Schema.Type<typeof trackMetadataSchema>;

export const decodeTrackMetadata = async (input: unknown) => {
  try {
    return await runAudioEffectWithoutServices(
      decodeTrackMetadataEffect(input).pipe(
        Effect.mapError(
          (cause) =>
            new AudioDecodeError({
              message: "malformed track metadata response.",
              cause,
            }),
        ),
      ),
    );
  } catch (error) {
    throw toPublicAudioError(error);
  }
};

export const resolveTrackMetadata = async (
  sourceUrl: string,
): Promise<TrackMetadata | undefined> => {
  const endpoint = new URL("/api/track-metadata", window.location.origin);
  endpoint.searchParams.set("url", sourceUrl);

  const response = await fetch(endpoint);
  if (response.status === 204) return undefined;
  if (!response.ok) throw new Error(`track metadata request failed (${response.status})`);
  return decodeTrackMetadata(await response.json());
};
