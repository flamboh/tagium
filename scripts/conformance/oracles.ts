import { constants } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import { materializeFixture } from "./fixture-generator";
import type { FixtureFamily, OracleResult } from "./types";
import { Effect } from "effect";

interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RuntimeDriver {
  readonly patch: (
    source: {
      size: number;
      read: (offset: number, length: number) => Effect.Effect<Uint8Array<ArrayBuffer>>;
      slice: (start?: number, end?: number) => Blob;
    },
    changes: Record<string, unknown>,
  ) => Effect.Effect<{ parts: BlobPart[] }, unknown>;
}

export const PINNED_ORACLE_VERSIONS = {
  ffprobe: "8.1.1",
  mutagen: "1.47.0",
  taglib: "2.3",
} as const;

const which = async (executable: string) => {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(directory, executable);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
};

const command = (args: readonly string[]): Promise<CommandResult> =>
  new Promise((resolve) => {
    const child = spawn(args[0]!, args.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => resolve({ exitCode: -1, stdout: "", stderr: error.message }));
    child.on("close", (exitCode) =>
      resolve({
        exitCode: exitCode ?? -1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });

const versionOf = async (args: readonly string[]) => {
  const result = await command(args);
  return `${result.stdout}\n${result.stderr}`.trim().split("\n")[0]?.slice(0, 200);
};

const writeSamples = async (directory: string) => {
  const modulePaths = [
    "../../src/features/audio/metadataEngine/mp3/mp3Driver.ts",
    "../../src/features/audio/metadataEngine/flac/index.ts",
    "../../src/features/audio/metadataEngine/mp4/index.ts",
  ];
  const [mp3, flac, mp4] = await Promise.all(
    modulePaths.map(async (path) => await import(new URL(path, import.meta.url).href)),
  );
  const drivers = {
    mp3: mp3.mp3Driver as RuntimeDriver,
    flac: flac.flacDriver as RuntimeDriver,
    m4a: mp4.mp4Driver as RuntimeDriver,
  } as const;
  const paths: Array<{ family: FixtureFamily; path: string; outputPath: string }> = [];
  for (const family of ["mp3", "flac", "m4a"] as const) {
    for (const index of [0, 1, 3]) {
      const path = join(directory, `${family}-${index}.${family}`);
      const outputPath = join(directory, `${family}-${index}-patched.${family}`);
      const bytes = materializeFixture(family, index).bytes;
      await writeFile(path, bytes);
      const blob = new Blob([Uint8Array.from(bytes)]);
      const source = {
        size: blob.size,
        read: (offset: number, length: number) =>
          Effect.promise(
            async () => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
          ),
        slice: (start?: number, end?: number) => blob.slice(start, end),
      };
      const plan = await Effect.runPromise(
        drivers[family].patch(source, { title: "Oracle changed" }),
      );
      await writeFile(outputPath, new Uint8Array(await new Blob(plan.parts).arrayBuffer()));
      paths.push({ family, path, outputPath });
    }
  }
  return { samples: paths, drivers };
};

const skipped = (oracle: OracleResult["oracle"], detail: string): OracleResult => ({
  oracle,
  status: "skipped",
  checkedCases: 0,
  detail,
});

export const runExternalOracles = async (): Promise<OracleResult[]> => {
  const directory = await mkdtemp(join(tmpdir(), "tagium-conformance-"));
  try {
    const { samples, drivers } = await writeSamples(directory);
    const results: OracleResult[] = [];
    const ffprobe = await which("ffprobe");
    if (!ffprobe) results.push(skipped("ffprobe", "ffprobe was not found on PATH"));
    else {
      const version = await versionOf([ffprobe, "-version"]);
      const ffmpeg = await which("ffmpeg");
      let readable = 0;
      let readableOutputs = 0;
      let metadataOutputs = 0;
      const familyCounts = new Map<
        FixtureFamily,
        { input: number; output: number; title: number }
      >();
      for (const sample of samples) {
        const counts = familyCounts.get(sample.family) ?? { input: 0, output: 0, title: 0 };
        const result = await command([
          ffprobe,
          "-v",
          "error",
          "-show_entries",
          "format=format_name:format_tags",
          "-of",
          "json",
          sample.path,
        ]);
        if (result.exitCode === 0) {
          readable++;
          counts.input++;
        }
        const output = await command([
          ffprobe,
          "-v",
          "error",
          "-show_entries",
          "format=format_name:format_tags",
          "-of",
          "json",
          sample.outputPath,
        ]);
        if (output.exitCode === 0) {
          readableOutputs++;
          counts.output++;
        }
        if (output.stdout.includes("Oracle changed")) {
          metadataOutputs++;
          counts.title++;
        }
        familyCounts.set(sample.family, counts);
      }
      const familyPassed = [...familyCounts.values()].every(
        (counts) =>
          counts.input > 0 && counts.output === counts.input && counts.title === counts.input,
      );
      let decodedOutputs = 0;
      const decoderCases = ffmpeg
        ? [
            { family: "mp3" as const, extension: "mp3", codec: "libmp3lame" },
            { family: "flac" as const, extension: "flac", codec: "flac" },
            { family: "m4a" as const, extension: "m4a", codec: "aac" },
            { family: "m4a" as const, extension: "m4a", codec: "alac" },
          ]
        : [];
      for (const [index, decoderCase] of decoderCases.entries()) {
        const inputPath = join(directory, `decoder-${index}.${decoderCase.extension}`);
        const outputPath = join(directory, `decoder-${index}-patched.${decoderCase.extension}`);
        const generated = await command([
          ffmpeg!,
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=44100:cl=stereo",
          "-t",
          "0.1",
          "-map_metadata",
          "-1",
          "-fflags",
          "+bitexact",
          "-flags:a",
          "+bitexact",
          "-c:a",
          decoderCase.codec,
          "-y",
          inputPath,
        ]);
        if (generated.exitCode !== 0) continue;
        const bytes = new Uint8Array(await readFile(inputPath));
        const blob = new Blob([bytes]);
        const source = {
          size: blob.size,
          read: (offset: number, length: number) =>
            Effect.promise(
              async () => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
            ),
          slice: (start?: number, end?: number) => blob.slice(start, end),
        };
        try {
          const plan = await Effect.runPromise(
            drivers[decoderCase.family].patch(source, { title: "Oracle changed" }),
          );
          await writeFile(outputPath, new Uint8Array(await new Blob(plan.parts).arrayBuffer()));
          const decoded = await command([
            ffmpeg!,
            "-v",
            "error",
            "-i",
            outputPath,
            "-f",
            "null",
            "-",
          ]);
          if (decoded.exitCode === 0) decodedOutputs++;
        } catch {
          // The failed count below makes this release oracle fail.
        }
      }
      results.push({
        oracle: "ffprobe",
        status:
          familyPassed && decodedOutputs === 4 && version?.includes(PINNED_ORACLE_VERSIONS.ffprobe)
            ? "passed"
            : "failed",
        version,
        checkedCases: samples.length + decoderCases.length,
        detail: `${readable}/${samples.length} synthetic inputs and outputs readable with ${metadataOutputs} patched titles; ${decodedOutputs}/4 decoder-valid MP3, FLAC, AAC, and ALAC patched outputs decoded; by family ${JSON.stringify(Object.fromEntries(familyCounts))}; pinned ${PINNED_ORACLE_VERSIONS.ffprobe}`,
      });
    }

    const python = (await which("python3")) ?? (await which("python"));
    if (!python) results.push(skipped("mutagen", "Python was not found on PATH"));
    else {
      const probe = await command([
        python,
        "-c",
        "import mutagen; print(getattr(mutagen, 'version_string', 'unknown'))",
      ]);
      if (probe.exitCode !== 0) results.push(skipped("mutagen", "Python Mutagen is not installed"));
      else {
        let readable = 0;
        let readableOutputs = 0;
        let metadataOutputs = 0;
        const familyCounts = new Map<
          FixtureFamily,
          { input: number; output: number; title: number }
        >();
        const inspect =
          "import mutagen,sys; f=mutagen.File(sys.argv[1], easy=True); print((f.get('title') or [''])[0] if f is not None else ''); raise SystemExit(0 if f is not None else 2)";
        for (const sample of samples) {
          const counts = familyCounts.get(sample.family) ?? { input: 0, output: 0, title: 0 };
          const result = await command([python, "-c", inspect, sample.path]);
          if (result.exitCode === 0) {
            readable++;
            counts.input++;
          }
          const output = await command([python, "-c", inspect, sample.outputPath]);
          if (output.exitCode === 0) {
            readableOutputs++;
            counts.output++;
          }
          if (output.stdout.trim() === "Oracle changed") {
            metadataOutputs++;
            counts.title++;
          }
          familyCounts.set(sample.family, counts);
        }
        const version = probe.stdout.trim();
        const familyPassed = [...familyCounts.values()].every(
          (counts) =>
            counts.input > 0 && counts.output === counts.input && counts.title === counts.input,
        );
        results.push({
          oracle: "mutagen",
          status:
            familyPassed && version.includes(PINNED_ORACLE_VERSIONS.mutagen) ? "passed" : "failed",
          version,
          checkedCases: samples.length,
          detail: `${readable}/${samples.length} inputs and ${readableOutputs}/${samples.length} patched outputs recognized; ${metadataOutputs} patched titles confirmed; by family ${JSON.stringify(Object.fromEntries(familyCounts))}; pinned ${PINNED_ORACLE_VERSIONS.mutagen}`,
        });
      }
    }

    let taglib = (await which("tagreader")) ?? (await which("taglib"));
    let taglibVersion: string | undefined;
    const taglibConfig = await which("taglib-config");
    const compiler = await which("c++");
    if (!taglib && taglibConfig && compiler) {
      const sourcePath = join(directory, "taglib-oracle.cpp");
      const executablePath = join(directory, "taglib-oracle");
      await writeFile(
        sourcePath,
        "#include <taglib/fileref.h>\n#include <iostream>\nint main(int argc,char** argv){if(argc!=2)return 2;TagLib::FileRef f(argv[1]);if(f.isNull()||!f.tag())return 3;std::cout<<f.tag()->title().to8Bit(true);return 0;}\n",
      );
      const flags = await command([taglibConfig, "--cflags", "--libs"]);
      const compiled = await command([
        compiler,
        sourcePath,
        "-o",
        executablePath,
        ...flags.stdout.trim().split(/\s+/u).filter(Boolean),
      ]);
      if (compiled.exitCode === 0) taglib = executablePath;
      taglibVersion = (await command([taglibConfig, "--version"])).stdout.trim();
    }
    if (!taglib)
      results.push(
        skipped("taglib", "TagLib CLI or compilable taglib-config installation was not found"),
      );
    else {
      const probe = taglibVersion ?? (await versionOf([taglib, "--version"]));
      let readable = 0;
      let readableOutputs = 0;
      let metadataOutputs = 0;
      const familyCounts = new Map<
        FixtureFamily,
        { input: number; output: number; title: number }
      >();
      for (const sample of samples) {
        const counts = familyCounts.get(sample.family) ?? { input: 0, output: 0, title: 0 };
        const result = await command([taglib, sample.path]);
        if (result.exitCode === 0) {
          readable++;
          counts.input++;
        }
        const output = await command([taglib, sample.outputPath]);
        if (output.exitCode === 0) {
          readableOutputs++;
          counts.output++;
        }
        if (output.stdout.trim() === "Oracle changed") {
          metadataOutputs++;
          counts.title++;
        }
        familyCounts.set(sample.family, counts);
      }
      const familyPassed = [...familyCounts.values()].every(
        (counts) =>
          counts.input > 0 && counts.output === counts.input && counts.title === counts.input,
      );
      results.push({
        oracle: "taglib",
        status:
          familyPassed && probe?.includes(PINNED_ORACLE_VERSIONS.taglib) ? "passed" : "failed",
        version: probe,
        checkedCases: samples.length,
        detail: `${readable}/${samples.length} inputs and ${readableOutputs}/${samples.length} patched outputs recognized; ${metadataOutputs} patched titles confirmed; by family ${JSON.stringify(Object.fromEntries(familyCounts))}; pinned ${PINNED_ORACLE_VERSIONS.taglib}`,
      });
    }
    return results;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};
