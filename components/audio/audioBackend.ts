import { Context, Effect, Layer } from "effect";
import { CobaltAudio, CobaltAudioLive, type CobaltAudioDownloadRequest } from "./cobaltAudio";
import { AudioMetadataIO, AudioMetadataIOLive } from "./audioMetadataIO";
import { makeAudioRuntime } from "./audioRuntime";
import type { AudioMetadata, TagiumFile } from "./types";
import type { UploadedTrack } from "./mp3Utils";

export interface AudioBackendService {
  readonly downloadFromCobalt: (request: CobaltAudioDownloadRequest) => Effect.Effect<File, Error>;
  readonly parseUploads: (uploadedFiles: File[]) => Effect.Effect<UploadedTrack[], never>;
  readonly writeTags: (
    fileToUpdate: TagiumFile,
    newTags: AudioMetadata,
  ) => Effect.Effect<File, Error>;
}

const makeAudioBackend = Effect.gen(function* () {
  const cobaltAudio = yield* CobaltAudio;
  const metadataIO = yield* AudioMetadataIO;

  return AudioBackend.of({
    downloadFromCobalt: (request) => cobaltAudio.download(request),
    parseUploads: (uploadedFiles) => metadataIO.parseUploadedTracks(uploadedFiles),
    writeTags: (fileToUpdate, newTags) => metadataIO.writeMetadataToFile(fileToUpdate, newTags),
  });
});

export class AudioBackend extends Context.Service<AudioBackend, AudioBackendService>()(
  "AudioBackend",
) {}

export const AudioBackendLayer = Layer.effect(AudioBackend, makeAudioBackend);

export const AudioBackendLive = AudioBackendLayer.pipe(
  Layer.provide(Layer.merge(CobaltAudioLive, AudioMetadataIOLive)),
);

const audioBackendRuntime = makeAudioRuntime(AudioBackendLive);

export const downloadFromCobalt = (request: CobaltAudioDownloadRequest) =>
  Effect.scoped(
    Effect.gen(function* () {
      const signal = yield* Effect.abortSignal;
      const backend = yield* AudioBackend;
      return yield* backend.downloadFromCobalt({
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
