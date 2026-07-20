import { Effect } from "effect";
import { materializeFixture } from "./fixture-generator";
import { audioPayloadSha256 } from "./structural";
import type { AssertionResult, FixtureFamily } from "./types";

interface RuntimeInspection {
  readonly metadata: {
    readonly title: string;
    readonly artist: string;
    readonly album: string;
    readonly year: number | null;
    readonly trackNumber: number | null;
    readonly genre: string | readonly string[];
    readonly picture: readonly unknown[];
  };
}

interface RuntimePatchPlan {
  readonly parts: BlobPart[];
}

interface RuntimeByteSource {
  readonly size: number;
  readonly read: (offset: number, length: number) => Effect.Effect<Uint8Array<ArrayBuffer>>;
  readonly slice: (start?: number, end?: number) => Blob;
}

interface RuntimeDriver {
  readonly inspect: (source: RuntimeByteSource) => Effect.Effect<RuntimeInspection, unknown>;
  readonly patch: (
    source: RuntimeByteSource,
    changes: Record<string, unknown>,
  ) => Effect.Effect<RuntimePatchPlan, unknown>;
}

interface DriverModule {
  readonly mp3Driver?: RuntimeDriver;
  readonly flacDriver?: RuntimeDriver;
  readonly mp4Driver?: RuntimeDriver;
}

const makeSource = (blob: Blob): RuntimeByteSource => ({
  size: blob.size,
  read: (offset, length) =>
    Effect.promise(
      async () => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
    ),
  slice: (start, end) => blob.slice(start, end),
});

const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const blobOf = (bytes: Uint8Array) => new Blob([Uint8Array.from(bytes)]);

const loadDrivers = async (): Promise<Record<FixtureFamily, RuntimeDriver>> => {
  // Computed specifiers keep this Node-targeted CLI out of the browser tsconfig while Bun
  // still resolves the application's @ aliases when conformance actually runs.
  const paths = [
    "../../src/features/audio/metadataEngine/mp3/mp3Driver.ts",
    "../../src/features/audio/metadataEngine/flac/index.ts",
    "../../src/features/audio/metadataEngine/mp4/index.ts",
  ];
  const [mp3, flac, mp4] = await Promise.all(
    paths.map(async (path) => (await import(new URL(path, import.meta.url).href)) as DriverModule),
  );
  if (!mp3?.mp3Driver || !flac?.flacDriver || !mp4?.mp4Driver)
    throw new Error("production metadata drivers are unavailable");
  return { mp3: mp3.mp3Driver, flac: flac.flacDriver, m4a: mp4.mp4Driver };
};

export const runProductionChecks = async (): Promise<AssertionResult[]> => {
  let drivers: Record<FixtureFamily, RuntimeDriver>;
  try {
    drivers = await loadDrivers();
  } catch (error) {
    return [
      {
        name: "production-driver integration checks",
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      },
    ];
  }
  const { detectAudioFormat } = (await import(
    new URL("../../src/features/audio/metadataEngine/detect.ts", import.meta.url).href
  )) as { detectAudioFormat: (source: RuntimeByteSource) => Effect.Effect<FixtureFamily, unknown> };
  const results: AssertionResult[] = [];
  for (const family of ["mp3", "flac", "m4a"] as const) {
    const driver = drivers[family];
    let noOpPassed = 0;
    let inspected = 0;
    let canonicalPassed = 0;
    let editedPassed = 0;
    const errors: string[] = [];
    const indexes = Array.from({ length: 180 }, (_, index) => index).filter(
      (index) => index % 10 !== 9,
    );
    for (const index of indexes) {
      const fixture = materializeFixture(family, index);
      const source = makeSource(blobOf(fixture.bytes));
      try {
        const inspection = await Effect.runPromise(driver.inspect(source));
        inspected++;
        const expectedGenre =
          fixture.metadata.genres.length > 1
            ? fixture.metadata.genres
            : (fixture.metadata.genres[0] ?? "");
        const genreMatches =
          Array.isArray(expectedGenre) && Array.isArray(inspection.metadata.genre)
            ? expectedGenre.length === inspection.metadata.genre.length &&
              expectedGenre.every(
                (value, genreIndex) => value === inspection.metadata.genre[genreIndex],
              )
            : expectedGenre === inspection.metadata.genre;
        if (
          inspection.metadata.title === fixture.metadata.title &&
          inspection.metadata.artist === fixture.metadata.artist &&
          inspection.metadata.album === fixture.metadata.album &&
          inspection.metadata.year ===
            (fixture.metadata.date.match(/^\d{4}/u)
              ? Number(fixture.metadata.date.slice(0, 4))
              : null) &&
          inspection.metadata.trackNumber === fixture.metadata.trackNumber &&
          genreMatches &&
          inspection.metadata.picture.length === fixture.metadata.artworkCount
        )
          canonicalPassed++;
        const plan = await Effect.runPromise(driver.patch(source, {}));
        const output = new Uint8Array(await new Blob(plan.parts).arrayBuffer());
        if (bytesEqual(output, fixture.bytes)) noOpPassed++;
        const editedPlan = await Effect.runPromise(
          driver.patch(source, { title: "Changed title" }),
        );
        const editedOutput = new Uint8Array(await new Blob(editedPlan.parts).arrayBuffer());
        const edited = await Effect.runPromise(
          driver.inspect(makeSource(new Blob([editedOutput]))),
        );
        if (
          edited.metadata.title === "Changed title" &&
          audioPayloadSha256(family, editedOutput) === audioPayloadSha256(family, fixture.bytes)
        )
          editedPassed++;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    const expected = indexes.length;
    results.push({
      name: `${family}: production inspect accepts every valid corpus fixture`,
      status: inspected === expected ? "passed" : "failed",
      detail:
        inspected === expected
          ? `${expected}/${expected} inspected`
          : `${inspected}/${expected} inspected; ${errors.slice(0, 2).join("; ")}`,
    });
    results.push({
      name: `${family}: canonical editable projection matches golden metadata`,
      status: canonicalPassed === expected ? "passed" : "failed",
      detail: `${canonicalPassed}/${expected} golden projections matched`,
    });
    results.push({
      name: `${family}: production no-op patch is byte-identical`,
      status: noOpPassed === expected ? "passed" : "failed",
      detail: `${noOpPassed}/${expected} byte-identical`,
    });
    results.push({
      name: `${family}: production edit preserves independent audio hash`,
      status: editedPassed === expected ? "passed" : "failed",
      detail: `${editedPassed}/${expected} edits preserved essence`,
    });
    let adversarialRejected = 0;
    for (let index = 9; index < 180; index += 10) {
      const fixture = materializeFixture(family, index);
      try {
        const source = makeSource(blobOf(fixture.bytes));
        const detected = await Effect.runPromise(detectAudioFormat(source));
        if (detected !== family) throw new Error("mismatched detected family");
        await Effect.runPromise(driver.inspect(source));
      } catch {
        adversarialRejected++;
      }
    }
    results.push({
      name: `${family}: production rejects every adversarial corpus fixture`,
      status: adversarialRejected === 18 ? "passed" : "failed",
      detail: `${adversarialRejected}/18 rejected`,
    });
  }
  for (const [family, index, marker] of [
    ["mp3", 3, "TAGIUM_PRIVATE"],
    ["flac", 2, "opaque-block-2"],
    ["m4a", 3, "opaque-atom-3"],
  ] as const) {
    const driver = drivers[family];
    const fixture = materializeFixture(family, index);
    try {
      const beforeHash = audioPayloadSha256(family, fixture.bytes);
      const before = await Effect.runPromise(driver.inspect(makeSource(blobOf(fixture.bytes))));
      const plan = await Effect.runPromise(
        driver.patch(makeSource(blobOf(fixture.bytes)), { title: "Changed title" }),
      );
      const output = new Uint8Array(await new Blob(plan.parts).arrayBuffer());
      const after = await Effect.runPromise(driver.inspect(makeSource(new Blob([output]))));
      const opaquePreserved = new TextDecoder("latin1").decode(output).includes(marker);
      const passed =
        beforeHash === audioPayloadSha256(family, output) &&
        opaquePreserved &&
        after.metadata.title === "Changed title" &&
        after.metadata.picture.length === before.metadata.picture.length;
      results.push({
        name: `${family}: edit preserves audio essence, opaque metadata, and extra artwork`,
        status: passed ? "passed" : "failed",
      });
    } catch (error) {
      results.push({
        name: `${family}: edit preserves audio essence, opaque metadata, and extra artwork`,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
};
