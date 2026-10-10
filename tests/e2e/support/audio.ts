import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { Effect } from "effect";
import { unzipSync } from "fflate";
import {
  inspectAudioFile,
  patchAudioFile,
} from "../../../src/features/audio/metadataEngine/engine";
import type { AudioMetadata } from "../../../src/features/library/types";
import {
  audioFixtures,
  imageFixtures,
  type AudioFixtureName,
  type ImageFixtureName,
} from "../fixtures/catalog.ts";
import { audioPayloadSha256 } from "./audioFixtures";

export type DownloadedFile = { filename: string; bytes: Uint8Array };

const fixtureBytes = (file: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url))));

export const audioFixture = (
  name: AudioFixtureName,
  filename: string = audioFixtures[name].file,
) => {
  const bytes = fixtureBytes(audioFixtures[name].file);
  return {
    upload: { name: filename, mimeType: audioFixtures[name].mime, buffer: Buffer.from(bytes) },
    file: { filename, bytes } satisfies DownloadedFile,
  };
};

export const retaggedAudioFixture = async (
  name: AudioFixtureName,
  filename: string,
  changes: Partial<AudioMetadata>,
) => {
  const source = new File([Buffer.from(fixtureBytes(audioFixtures[name].file))], filename);
  const { metadata } = await Effect.runPromise(inspectAudioFile(source));
  const patched = await Effect.runPromise(patchAudioFile(source, { ...metadata, ...changes }));
  const bytes = new Uint8Array(await patched.arrayBuffer());
  return {
    upload: { name: filename, mimeType: audioFixtures[name].mime, buffer: Buffer.from(bytes) },
    file: { filename, bytes } satisfies DownloadedFile,
  };
};

export const imageFixture = (name: ImageFixtureName) => {
  const bytes = fixtureBytes(imageFixtures[name].file);
  return {
    upload: {
      name: imageFixtures[name].file,
      mimeType: imageFixtures[name].mime,
      buffer: Buffer.from(bytes),
    },
    bytes,
  };
};

export const captureDownload = async (
  page: Page,
  trigger: () => Promise<void>,
): Promise<DownloadedFile> => {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger()]);
  const path = await download.path();
  return { filename: download.suggestedFilename(), bytes: new Uint8Array(await readFile(path)) };
};

export const unzipDownload = (download: DownloadedFile): DownloadedFile[] =>
  Object.entries(unzipSync(download.bytes))
    .filter(([name]) => !name.endsWith("/"))
    .map(([filename, bytes]) => ({ filename, bytes }));

export const inspectAudio = async (file: DownloadedFile) => {
  const { inspection, metadata } = await Effect.runPromise(
    inspectAudioFile(new File([Buffer.from(file.bytes)], file.filename)),
  );
  return { format: inspection.format.kind, metadata };
};

export const audioPayloadDigest = async (file: DownloadedFile) =>
  audioPayloadSha256((await inspectAudio(file)).format, file.bytes);

export const expectLosslessAudio = async (exported: DownloadedFile, original: DownloadedFile) => {
  const [exportedFormat, originalFormat] = await Promise.all([
    inspectAudio(exported).then(({ format }) => format),
    inspectAudio(original).then(({ format }) => format),
  ]);
  expect(exportedFormat, `${exported.filename} format`).toBe(originalFormat);
  expect(
    audioPayloadSha256(exportedFormat, exported.bytes),
    `${exported.filename} audio payload`,
  ).toBe(audioPayloadSha256(originalFormat, original.bytes));
};
