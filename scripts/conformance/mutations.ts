import { createHash } from "node:crypto";
import { Effect } from "effect";
import { extractAudioPayload } from "./structural";
import { materializeFixture } from "./fixture-generator";
import { xorshift32 } from "./bytes";
import type { FixtureFamily, MutationResult } from "./types";

interface RuntimeSource {
  readonly size: number;
  readonly read: (offset: number, length: number) => Effect.Effect<Uint8Array<ArrayBuffer>, Error>;
  readonly slice: (start?: number, end?: number) => Blob;
}

interface RuntimeDriver {
  readonly inspect: (source: RuntimeSource) => Effect.Effect<unknown, unknown>;
  readonly patch: (
    source: RuntimeSource,
    changes: Record<string, unknown>,
  ) => Effect.Effect<{ parts: BlobPart[] }, unknown>;
}

const loadProduction = async () => {
  const paths = [
    "../../src/features/audio/metadataEngine/detect.ts",
    "../../src/features/audio/metadataEngine/mp3/mp3Driver.ts",
    "../../src/features/audio/metadataEngine/flac/index.ts",
    "../../src/features/audio/metadataEngine/mp4/index.ts",
  ];
  const [detect, mp3, flac, mp4] = await Promise.all(
    paths.map(async (path) => await import(new URL(path, import.meta.url).href)),
  );
  return {
    detect: detect.detectAudioFormat as (
      source: RuntimeSource,
    ) => Effect.Effect<FixtureFamily, unknown>,
    drivers: {
      mp3: mp3.mp3Driver as RuntimeDriver,
      flac: flac.flacDriver as RuntimeDriver,
      m4a: mp4.mp4Driver as RuntimeDriver,
    } satisfies Record<FixtureFamily, RuntimeDriver>,
  };
};

const productionPromise = loadProduction();

const sourceOf = (bytes: Uint8Array): RuntimeSource => {
  const immutable = Uint8Array.from(bytes);
  const blob = new Blob([immutable]);
  return {
    size: blob.size,
    slice: (start, end) => blob.slice(start, end),
    read: (offset, length) =>
      length > 8 * 1024 * 1024
        ? Effect.fail(new Error("production mutation requested an oversized range"))
        : Effect.promise(
            async () => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
          ),
  };
};

export const DEFAULT_MUTATIONS_PER_FAMILY = 10_000;
export const EXTENDED_TOTAL_MUTATIONS = 1_000_000;

const mutate = (source: Uint8Array, iteration: number, random: () => number) => {
  const mode = iteration % 5;
  if (mode === 1 && source.length > 1) return source.slice(0, random() % source.length);
  const output = source.slice();
  const offset = random() % output.length;
  if (mode === 2 && output.length >= 10) {
    output.set([0x7f, 0x7f, 0x7f, 0x7f], 6);
  } else if (mode === 3) {
    output[offset] = 0;
  } else if (mode === 4) {
    output[offset] = 0xff;
  } else {
    output[offset] ^= 1 << (random() % 8);
  }
  return output;
};

export const runMutations = async (
  family: FixtureFamily,
  requested = DEFAULT_MUTATIONS_PER_FAMILY,
  seed = 0x4d55_5441,
): Promise<MutationResult> => {
  const production = await productionPromise;
  const random = xorshift32(seed ^ family.charCodeAt(0));
  const digest = createHash("sha256");
  let accepted = 0;
  let rejected = 0;
  let crashes = 0;
  for (let iteration = 0; iteration < requested; iteration++) {
    const fixture = materializeFixture(family, (iteration * 7) % 170).bytes;
    try {
      const candidate = mutate(fixture, iteration, random);
      const originalCandidate = Uint8Array.from(candidate);
      let beforeHash: string;
      try {
        beforeHash = createHash("sha256")
          .update(extractAudioPayload(family, candidate))
          .digest("hex");
      } catch {
        rejected++;
        digest.update(Uint8Array.of(0, candidate.length & 0xff));
        continue;
      }
      try {
        const source = sourceOf(candidate);
        const detected = await Effect.runPromise(production.detect(source));
        if (detected !== family) throw new Error("production detector selected another family");
        const driver = production.drivers[family];
        await Effect.runPromise(driver.inspect(source));
        const plan = await Effect.runPromise(driver.patch(source, { title: "Mutation check" }));
        const output = new Uint8Array(await new Blob(plan.parts).arrayBuffer());
        await Effect.runPromise(driver.inspect(sourceOf(output)));
        const afterHash = createHash("sha256")
          .update(extractAudioPayload(family, output))
          .digest("hex");
        if (beforeHash !== afterHash) throw new Error("accepted output changed audio essence");
        if (!candidate.every((value, index) => value === originalCandidate[index])) {
          throw new Error("production mutation changed its original input");
        }
        accepted++;
        digest.update(Uint8Array.of(1, output.length & 0xff));
      } catch (error) {
        const tag =
          typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : "";
        if (tag !== "AudioMetadataReadError" && tag !== "AudioMetadataWriteError") crashes++;
        rejected++;
        digest.update(Uint8Array.of(0, candidate.length & 0xff));
      }
    } catch {
      crashes++;
    }
  }
  return {
    family,
    requested,
    completed: requested,
    accepted,
    rejected,
    crashes,
    digest: digest.digest("hex"),
  };
};
