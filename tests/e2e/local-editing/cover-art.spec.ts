import { Buffer } from "node:buffer";
import { crc32, deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { readCoverArtDimensions } from "../../../src/features/editor/coverArtProcessing";
import { fixtureTitle } from "../fixtures/catalog.ts";
import { audioFixture, expectLosslessAudio, imageFixture, inspectAudio } from "../support/audio";
import { expect, test } from "../support/test";
import {
  downloadTrack,
  field,
  pickFiles,
  taggedFixture,
  taggedTags,
  type Upload,
} from "./workspace";

const uploadCover = async (page: Page, upload: Upload) => {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "upload cover" }).click();
  await (await chooser).setFiles(upload);
};

const exportedCover = async (page: Page) => {
  const exported = await downloadTrack(page);
  const { metadata } = await inspectAudio(exported);
  expect(metadata.picture).toHaveLength(1);
  return { exported, picture: metadata.picture[0]! };
};

const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  Buffer.from(left).equals(Buffer.from(right));

const pngChunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
};

const png = (width: number, height: number, pixels = true): Upload => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x5a)]);
  return {
    name: `cover-${width}x${height}.png`,
    mimeType: "image/png",
    buffer: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", header),
      ...(pixels ? [pngChunk("IDAT", deflateSync(Buffer.concat(Array(height).fill(row))))] : []),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  };
};

for (const format of ["m4a", "opus"] as const) {
  test(`adds and crops cover art on a coverless ${format} track`, async ({ page }) => {
    const source = taggedFixture(format);
    const thumbnail = imageFixture("thumbnail");
    await page.goto("/");
    await pickFiles(page, [source.upload]);
    await expect(field(page, "title")).toHaveValue(taggedTags.title(format));
    await expect(page.getByText("no cover", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "crop cover art" })).toHaveCount(0);

    await uploadCover(page, thumbnail.upload);
    await expect(page.getByRole("img", { name: "album cover" })).toBeVisible();
    const added = await exportedCover(page);
    expect(added.picture.format).toBe("image/jpeg");
    expect(sameBytes(added.picture.data, thumbnail.bytes)).toBe(true);

    await page.getByRole("button", { name: "crop cover art" }).click();
    await expect(page.getByRole("img", { name: "crop preview" })).toBeVisible();
    await page.getByRole("button", { name: "cancel" }).click();
    await expect(page.getByRole("img", { name: "crop preview" })).toBeHidden();

    await page.getByRole("button", { name: "crop cover art" }).click();
    await page.getByRole("button", { name: "apply crop" }).click();
    await expect(page.getByRole("img", { name: "crop preview" })).toBeHidden();
    await expect(page.getByRole("button", { name: "upload cover" })).toBeEnabled();
    const cropped = await exportedCover(page);
    expect(cropped.picture.format).toBe("image/jpeg");
    const croppedSize = await readCoverArtDimensions(
      new File([Buffer.from(cropped.picture.data)], "cropped.jpg", { type: "image/jpeg" }),
    );
    expect(Math.abs(croppedSize.width - croppedSize.height)).toBeLessThanOrEqual(1);
    expect(croppedSize.width).toBeLessThanOrEqual(90);
    await expectLosslessAudio(cropped.exported, source.file);
  });

  test(`replaces ${format} cover art and keeps it when an image is rejected`, async ({ page }) => {
    const source = audioFixture(format);
    const artwork = imageFixture("artwork");
    await page.goto("/");
    await pickFiles(page, [source.upload]);
    await expect(field(page, "title")).toHaveValue(fixtureTitle(format));
    await expect(page.getByRole("img", { name: "album cover" })).toBeVisible();

    await uploadCover(page, artwork.upload);
    await expect(page.getByRole("button", { name: "upload cover" })).toBeEnabled();
    const replaced = await exportedCover(page);
    expect(replaced.picture.format).toBe("image/png");
    expect(sameBytes(replaced.picture.data, artwork.bytes)).toBe(true);

    const coverButton = page.getByRole("button", { name: "upload cover" });
    await uploadCover(page, {
      name: "bad.png",
      mimeType: "image/png",
      buffer: Buffer.from("this is not an image"),
    });
    await expect(coverButton).toHaveAttribute("aria-invalid", "true");
    await expect(coverButton).toHaveAccessibleDescription(
      "cover art has an invalid or unsupported image header.",
    );
    await uploadCover(page, {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("this is not an image"),
    });
    await expect(coverButton).toHaveAccessibleDescription("cover art image must be a jpeg or png.");
    await expect(page.getByRole("img", { name: "album cover" })).toBeVisible();

    const kept = await exportedCover(page);
    expect(kept.picture.format).toBe("image/png");
    expect(sameBytes(kept.picture.data, artwork.bytes)).toBe(true);
    await expectLosslessAudio(kept.exported, source.file);
  });
}

test("shrinks a large cover to 1600 pixels and refuses one over 16 megapixels", async ({
  page,
}) => {
  const source = audioFixture("mp3");
  await page.goto("/");
  await pickFiles(page, [source.upload]);
  await expect(field(page, "title")).toHaveValue(fixtureTitle("mp3"));
  const coverButton = page.getByRole("button", { name: "upload cover" });

  await uploadCover(page, png(2400, 1200));
  await expect(coverButton).toBeEnabled();
  await expect(coverButton).not.toHaveAttribute("aria-invalid", "true");
  const shrunk = await exportedCover(page);
  expect(shrunk.picture.format).toBe("image/png");
  expect(
    await readCoverArtDimensions(
      new File([Buffer.from(shrunk.picture.data)], "cover.png", { type: "image/png" }),
    ),
  ).toEqual({ width: 1600, height: 800 });

  await uploadCover(page, png(5000, 4000, false));
  await expect(coverButton).toHaveAccessibleDescription(
    "cover art must be 16 megapixels or smaller.",
  );
  const kept = await exportedCover(page);
  expect(sameBytes(kept.picture.data, shrunk.picture.data)).toBe(true);
  await expectLosslessAudio(kept.exported, source.file);
});
