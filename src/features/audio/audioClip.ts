import { Effect } from "effect";
import { AudioWorkerError, toPublicAudioError } from "@/features/audio/audioErrors";
import type { AudioClipMessage, AudioClipRequest } from "@/features/audio/audioClipWorker";
import { getAudioFormat } from "@/features/audio/audioFormat";
import { patchAudioFile } from "@/features/audio/metadataEngine/engine";
import type { AudioMetadata, TagiumFile, TrackClip } from "@/features/library/types";

const runAudioClipWorker = (request: AudioClipRequest) =>
  Effect.acquireUseRelease(
    Effect.sync(
      () => new Worker(new URL("./audioClipWorker.ts", import.meta.url), { type: "module" }),
    ),
    (worker) =>
      Effect.callback<Blob, AudioWorkerError>((resume) => {
        worker.onmessage = (event: MessageEvent<AudioClipMessage>) => {
          const message = event.data;
          resume(
            "blob" in message
              ? Effect.succeed(message.blob)
              : Effect.fail(new AudioWorkerError({ message: message.error, cause: message })),
          );
        };

        worker.onerror = (event) => {
          resume(
            Effect.fail(
              new AudioWorkerError({
                message: event.message || "audio clipping failed.",
                cause: event,
              }),
            ),
          );
        };

        worker.postMessage(request);
      }),
    (worker) => Effect.sync(() => worker.terminate()),
  );

/**
 * Cuts the exported audio to the clip, then rewrites the editable tags and artwork with the
 * metadata engine so the clipped file carries exactly what the editor shows.
 */
export const clipAudioFile = (
  file: File,
  track: Pick<TagiumFile, "format">,
  clip: TrackClip,
  metadata: AudioMetadata,
) =>
  Effect.gen(function* () {
    const blob = yield* runAudioClipWorker({
      file,
      kind: getAudioFormat(track).kind,
      start: clip.start,
      end: clip.end,
    });

    const clipped = new File([blob], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });

    // Raw artwork frames belong to the source tag (an ID3v2.3 frame copied into ffmpeg's
    // ID3v2.4 output is misread), so re-encode artwork for the new container.
    const picture = metadata.picture.map(({ opaqueData: _opaqueData, ...entry }) => entry);
    const tagged = yield* patchAudioFile(clipped, { ...metadata, picture });

    return new File([tagged], file.name, { type: tagged.type, lastModified: file.lastModified });
  }).pipe(Effect.mapError(toPublicAudioError));

/** Applies clips to the listed tracks' export files; every other track passes through untouched. */
export const applyTrackClips = <Track extends TagiumFile>(
  tracks: Track[],
  trackIds: ReadonlySet<string>,
) =>
  Effect.forEach(
    tracks,
    (track) =>
      trackIds.has(track.id) && track.clip && track.file && track.metadata
        ? clipAudioFile(track.file, track, track.clip, track.metadata).pipe(
            Effect.map((file): Track => ({ ...track, file })),
          )
        : Effect.succeed(track),
    { concurrency: 1 },
  );
