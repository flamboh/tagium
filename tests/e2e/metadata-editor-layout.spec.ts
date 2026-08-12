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
  const openLibrary = page.getByRole("button", { name: "open library" });
  const openedFromMobileLibrary = await openLibrary.isVisible();
  if (openedFromMobileLibrary) {
    await openLibrary.click();
    const library = page.getByRole("dialog", { name: "library" });
    await library.getByRole("button", { name: "settings" }).click();
  } else {
    await page.getByRole("button", { name: "settings" }).click();
  }
  await page.getByRole("button", { name: "editing", exact: true }).click();
  await page.getByRole("checkbox", { name: "show advanced fields" }).click();
  if (openedFromMobileLibrary) {
    await page.goBack();
  } else {
    await page.getByRole("button", { name: "back to workspace" }).click();
  }
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

test("keeps the mobile library button beside the filename", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "layout geometry is covered in Chromium");
  await page.setViewportSize({ width: 320, height: 568 });
  await uploadTrack(page);
  await enableAdvancedMetadata(page);
  await page
    .locator("#track-title")
    .fill("a very long filename that needs all of the available header width");

  const header = page.locator("[data-track-filename-header]");
  const menu = header.getByRole("button", { name: "open library" });
  const filename = header.getByRole("heading", { level: 2 });
  const modeToggle = header.getByRole("group", { name: "metadata fields" });
  const [headerBox, menuBox, filenameBox, modeToggleBox] = await Promise.all([
    header.boundingBox(),
    menu.boundingBox(),
    filename.boundingBox(),
    modeToggle.boundingBox(),
  ]);

  expect(headerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(filenameBox).not.toBeNull();
  expect(modeToggleBox).not.toBeNull();
  expect(menuBox!.x + menuBox!.width + 8).toBeLessThanOrEqual(filenameBox!.x);
  expect(filenameBox!.x + filenameBox!.width + 8).toBeLessThanOrEqual(modeToggleBox!.x);
  expect(modeToggleBox!.x + modeToggleBox!.width).toBeLessThanOrEqual(
    headerBox!.x + headerBox!.width - 12,
  );
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
