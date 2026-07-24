import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

const uploadTrack = async (page: Page) => {
  const mp3Bytes = new Uint8Array(834);
  mp3Bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  mp3Bytes.set([0xff, 0xfb, 0x90, 0x00], 417);

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "layout-track.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from(mp3Bytes),
  });
  await expect(page.getByRole("button", { name: "download track" })).toBeAttached();
};

const enableAdvancedMetadata = async (page: Page) => {
  await page.getByRole("button", { name: "settings" }).click();
  await page.getByRole("checkbox", { name: "enable advanced metadata" }).click();
  await page.getByRole("button", { name: "back to editor" }).click();
  await expect(page.getByRole("button", { name: "advanced" })).toBeVisible();
};

const readEditorLayout = async (page: Page) =>
  page.locator("[data-editor-form-area]").evaluate((formArea) => {
    const summary = document.querySelector<HTMLElement>("[data-track-file-summary]");
    const textarea = document.querySelector<HTMLElement>("#track-comment");
    const error = document.querySelector<HTMLElement>("#track-disc-number-error");
    if (!summary) throw new Error("track file summary was not found");

    const areaRect = formArea.getBoundingClientRect();
    const summaryRect = summary.getBoundingClientRect();
    return {
      areaHeight: areaRect.height,
      summaryOffsetTop: summary.offsetTop,
      summaryTop: summaryRect.top,
      textareaBottom: textarea?.getBoundingClientRect().bottom ?? null,
      errorBottom: error?.getBoundingClientRect().bottom ?? null,
    };
  });

for (const viewport of [
  { name: "desktop", width: 1280, height: 900 },
  { name: "compact", width: 390, height: 700 },
] as const) {
  test(`keeps metadata mode layout stable and lets fields grow at ${viewport.name} size`, async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "layout geometry is covered in Chromium");
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await uploadTrack(page);
    await enableAdvancedMetadata(page);
    await page.locator("#track-title").fill("Layout track");

    const normalLayout = await readEditorLayout(page);
    await page.getByRole("button", { name: "advanced" }).click();
    const advancedLayout = await readEditorLayout(page);

    expect(Math.abs(advancedLayout.areaHeight - normalLayout.areaHeight)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(advancedLayout.summaryOffsetTop - normalLayout.summaryOffsetTop),
    ).toBeLessThanOrEqual(1);

    const comment = page.locator("#track-comment");
    await comment.evaluate((element) => {
      element.style.height = `${element.getBoundingClientRect().height + 96}px`;
    });
    const resizedLayout = await readEditorLayout(page);
    expect(resizedLayout.areaHeight).toBeGreaterThan(advancedLayout.areaHeight + 64);
    expect(resizedLayout.summaryOffsetTop).toBeGreaterThan(advancedLayout.summaryOffsetTop + 64);
    expect(resizedLayout.textareaBottom).not.toBeNull();
    expect(resizedLayout.textareaBottom!).toBeLessThanOrEqual(resizedLayout.summaryTop);

    await comment.evaluate((element) => {
      element.style.height = "";
    });
    await page.locator("#track-disc-number").fill("0");
    await page.getByRole("button", { name: "download track" }).click();
    await expect(page.locator("#track-disc-number-error")).toBeVisible();

    const validationLayout = await readEditorLayout(page);
    expect(validationLayout.areaHeight).toBeGreaterThan(advancedLayout.areaHeight);
    expect(validationLayout.summaryOffsetTop).toBeGreaterThan(advancedLayout.summaryOffsetTop);
    expect(validationLayout.errorBottom).not.toBeNull();
    expect(validationLayout.errorBottom!).toBeLessThanOrEqual(validationLayout.summaryTop);
  });
}
