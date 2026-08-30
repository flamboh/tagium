import { expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { Effect } from "effect";
import { audioPayloadSha256, materializeFixture } from "./support/audioFixtures";
import { makeBlobByteSource } from "../../src/features/audio/metadataEngine/byteSource";
import { mp3Driver } from "../../src/features/audio/metadataEngine/mp3/mp3Driver";
import { flacDriver } from "../../src/features/audio/metadataEngine/flac";
import { mp4Driver } from "../../src/features/audio/metadataEngine/mp4";
import { opusDriver } from "../../src/features/audio/metadataEngine/opus";

const formats = [
  { family: "mp3", name: "synthetic.mp3", mimeType: "audio/mpeg", extension: ".mp3" },
  { family: "flac", name: "synthetic.flac", mimeType: "audio/flac", extension: ".flac" },
  { family: "m4a", name: "synthetic.m4a", mimeType: "audio/mp4", extension: ".m4a" },
  { family: "m4a", name: "synthetic.mp4", mimeType: "audio/mp4", extension: ".mp4" },
  { family: "opus", name: "synthetic.opus", mimeType: "audio/ogg", extension: ".opus" },
] as const;
const drivers = { mp3: mp3Driver, flac: flacDriver, m4a: mp4Driver, opus: opusDriver } as const;
const crc32 = (bytes: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const pngChunk = (type: string, data: Buffer) => {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0);
ihdr.writeUInt32BE(1, 4);
ihdr.set([8, 6, 0, 0, 0], 8);
const replacementCover = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", ihdr),
  pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
  pngChunk("IEND", Buffer.alloc(0)),
]);

test("imports, edits, and exports every supported container without changing format", async ({
  page,
}) => {
  test.setTimeout(60_000);
  for (const format of formats) {
    await page.goto("/");
    const fixture = await materializeFixture(format.family);
    const original = await Effect.runPromise(
      drivers[format.family].inspect(makeBlobByteSource(new Blob([fixture]))),
    );
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles([
        { name: format.name, mimeType: format.mimeType, buffer: Buffer.from(fixture) },
        {
          name: `second${format.extension}`,
          mimeType: format.mimeType,
          buffer: Buffer.from(fixture),
        },
      ]);

    const title = page.getByLabel("title", { exact: true });
    await expect(title, `${format.family} should open in the metadata editor`).toBeVisible();
    await title.fill(`Edited ${format.family}`);

    await page.getByRole("button", { name: "album actions for Synthetic Album 1" }).click();
    await page.getByRole("menuitem", { name: "edit album" }).click();
    const albumDialog = page.getByRole("dialog");
    await albumDialog.locator('input[accept="image/jpeg,image/png"]').setInputFiles({
      name: "replacement.png",
      mimeType: "image/png",
      buffer: replacementCover,
    });
    await expect(albumDialog.getByRole("button", { name: "crop cover art" })).toBeVisible();
    await albumDialog.locator("#album-title").fill("Edited Album");
    await albumDialog.locator("#album-artist").fill("Edited Album Artist");
    await albumDialog.locator("#album-genre").fill("Edited Genre");
    await albumDialog.locator("#album-year").fill("2032");
    await albumDialog.getByRole("button", { name: "save album" }).click();
    await expect(page.getByText(format.extension, { exact: true }).first()).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "download track" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().toLowerCase().endsWith(format.extension)).toBe(true);
    const firstPath = await download.path();
    expect(firstPath).not.toBeNull();
    const firstBytes = new Uint8Array(await readFile(firstPath!));
    expect(audioPayloadSha256(format.family, firstBytes)).toBe(
      audioPayloadSha256(format.family, fixture),
    );
    const inspected = await Effect.runPromise(
      drivers[format.family].inspect(makeBlobByteSource(new Blob([firstBytes]))),
    );
    expect(inspected.metadata).toMatchObject({
      title: `Edited ${format.family}`,
      artist: "Edited Album Artist",
      album: "Edited Album",
      year: 2032,
      genre: "Edited Genre",
    });
    expect(inspected.metadata.picture.length).toBeGreaterThanOrEqual(
      original.metadata.picture.length,
    );
    expect(inspected.metadata.picture[0]?.format).toBe("image/png");
    expect(inspected.metadata.picture[0]?.data).not.toEqual(original.metadata.picture[0]?.data);

    const repeatedDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "download track" }).click();
    const repeatedDownload = await repeatedDownloadPromise;
    const repeatedPath = await repeatedDownload.path();
    expect(repeatedPath).not.toBeNull();
    expect(new Uint8Array(await readFile(repeatedPath!))).toEqual(firstBytes);
  }
});
