import { Effect } from "effect";
import { AudioMetadataReadError } from "@/features/audio/audioErrors";
import { ascii, readUint32BE } from "@/features/audio/metadataEngine/binary";
import { synchsafeToNumber } from "@/features/audio/metadataEngine/binary";
import { isMp3Bytes } from "@/features/audio/mp3Compatibility";
import type { ByteSource } from "@/features/audio/metadataEngine/byteSource";
import type { AudioFormatKind } from "@/features/audio/metadataEngine/types";

const fail = (message: string) =>
  Effect.fail(new AudioMetadataReadError({ message, cause: undefined }));

// MPEG admission searches at most 16 KiB for consecutive frames. A 32 KiB
// leading window also lets the byte source reuse that read for ordinary ID3 tags
// when the selected driver inspects the same region.
const DETECTION_WINDOW = 32 * 1024;

export const detectAudioFormat = (source: ByteSource) =>
  Effect.gen(function* () {
    if (source.size === 0) return yield* fail("audio file is empty.");
    const head = yield* source.read(0, Math.min(source.size, DETECTION_WINDOW));
    if (head.length >= 4 && ascii(head, 0, 4) === "fLaC") return "flac" as const;
    if (head.length >= 12 && ascii(head, 4, 4) === "ftyp") {
      const declaredSize = readUint32BE(head, 0);
      if (declaredSize < 8 || declaredSize > source.size) {
        return yield* fail("invalid MP4 file type atom size.");
      }
      return "m4a" as const;
    }
    if (head.length >= 10 && ascii(head, 0, 3) === "ID3") {
      if ([head[6], head[7], head[8], head[9]].some((value) => (value! & 0x80) !== 0)) {
        return yield* fail("invalid ID3 tag size.");
      }
      const audioOffset =
        10 + synchsafeToNumber(head, 6) + (head[3] === 4 && (head[5]! & 0x10) !== 0 ? 10 : 0);
      if (audioOffset >= source.size) return yield* fail("ID3 tag has no MPEG audio payload.");
      if (audioOffset < head.length && isMp3Bytes(head.subarray(audioOffset))) {
        return "mp3" as const;
      }
      const audioHead = yield* source.read(
        audioOffset,
        Math.min(source.size - audioOffset, DETECTION_WINDOW),
      );
      if (isMp3Bytes(audioHead)) return "mp3" as const;
      return yield* fail("ID3 tag is not followed by valid MPEG audio frames.");
    }
    if (isMp3Bytes(head)) return "mp3" as const;
    return yield* fail(
      "unsupported or corrupt audio file. Tagium supports MP3, FLAC, and unencrypted M4A/MP4 audio.",
    );
  }) satisfies Effect.Effect<AudioFormatKind, AudioMetadataReadError>;
