import { Context, Effect, Layer } from "effect";
import {
  CobaltAudio,
  CobaltAudioLive,
  type AudioDownloadRequest,
} from "@/features/import/cobaltAudio";
import { SoundCloudAudio, SoundCloudAudioLive } from "@/features/import/soundcloudAudio";
import { AudioMetadataIO, AudioMetadataIOLive } from "@/features/audio/audioMetadataIO";
import { makeAudioRuntime } from "@/features/audio/audioRuntime";
import type { AudioMetadata, TagiumFile } from "@/features/library/types";
import type { UploadedTrack } from "@/features/audio/mp3Utils";
import { parseMediaLink } from "@/lib/media-link";

interface AudioBackendService {
  readonly downloadAudio: (request: AudioDownloadRequest) => Effect.Effect<File, Error>;
  readonly parseUploads: (uploadedFiles: File[]) => Effect.Effect<UploadedTrack[], never>;
  readonly writeTags: (
    fileToUpdate: TagiumFile,
    newTags: AudioMetadata,
  ) => Effect.Effect<File, Error>;
}

const makeAudioBackend = Effect.gen(function* () {
  const cobaltAudio = yield* CobaltAudio;
  const soundCloudAudio = yield* SoundCloudAudio;
  const metadataIO = yield* AudioMetadataIO;

  return AudioBackend.of({
    downloadAudio: (request) =>
      parseMediaLink(request.sourceUrl).provider === "soundcloud"
        ? soundCloudAudio.download(request)
        : cobaltAudio.download(request),
    parseUploads: (uploadedFiles) => metadataIO.parseUploadedTracks(uploadedFiles),
    writeTags: (fileToUpdate, newTags) => metadataIO.writeMetadataToFile(fileToUpdate, newTags),
  });
});

export class AudioBackend extends Context.Service<AudioBackend, AudioBackendService>()(
  "AudioBackend",
) {}

const AudioBackendLayer = Layer.effect(AudioBackend, makeAudioBackend);

const AudioBackendLive = AudioBackendLayer.pipe(
  Layer.provide(Layer.mergeAll(CobaltAudioLive, SoundCloudAudioLive, AudioMetadataIOLive)),
);

const audioBackendRuntime = makeAudioRuntime(AudioBackendLive);

export const downloadAudio = (request: AudioDownloadRequest) =>
  Effect.scoped(
    Effect.gen(function* () {
      const signal = yield* Effect.abortSignal;
      const backend = yield* AudioBackend;

      return yield* backend.downloadAudio({
        ...request,
        signal: request.signal ?? signal,
      });
    }),
  );

export const parseUploads = (uploadedFiles: File[]) =>
  Effect.gen(function* () {
    const backend = yield* AudioBackend;

    return yield* backend.parseUploads(uploadedFiles);
  });

export const writeTags = (fileToUpdate: TagiumFile, newTags: AudioMetadata) =>
  Effect.gen(function* () {
    const backend = yield* AudioBackend;

    return yield* backend.writeTags(fileToUpdate, newTags);
  });

export const runAudioBackendEffect = <A, E>(effect: Effect.Effect<A, E, AudioBackend>) =>
  audioBackendRuntime.runPromise(effect);

export const provideAudioBackend = <A, E>(effect: Effect.Effect<A, E, AudioBackend>) =>
  Effect.gen(function* () {
    const context = yield* audioBackendRuntime.contextEffect;

    return yield* effect.pipe(Effect.provideContext(context));
  });
