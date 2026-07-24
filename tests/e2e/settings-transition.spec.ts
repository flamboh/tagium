import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

const uploadTrack = async (page: Page) => {
  const mp3Bytes = new Uint8Array(834);
  mp3Bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  mp3Bytes.set([0xff, 0xfb, 0x90, 0x00], 417);

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "crossfade-track.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from(mp3Bytes),
  });
  await expect(page.getByRole("button", { name: "remove track" })).toBeAttached();
};

const getPopulatedTrackList = (page: Page) => {
  const libraryHeader = page.getByText("library (1)", { exact: true });
  return libraryHeader.locator("..").locator("xpath=following-sibling::div[1]");
};

const clickBlankTrackList = async (page: Page) => {
  const trackList = getPopulatedTrackList(page);
  await expect(trackList).toBeVisible();

  const bounds = await trackList.boundingBox();
  if (!bounds) throw new Error("populated track list bounds were not found");

  await trackList.click({
    position: { x: bounds.width / 2, y: bounds.height - 8 },
  });
};

test("unmounts the media entry in settings and restores its source URL", async ({ page }) => {
  const shareLink = "https://tagium.app/share/abcdefghijklmnopqrstuv";
  await page.goto("/");
  const mediaUrl = page.locator('input[name="media-url"]');
  await mediaUrl.fill(shareLink);

  await page.getByRole("button", { name: "settings" }).click();
  await expect(mediaUrl).not.toBeAttached();

  await page.getByRole("button", { name: "back to editor" }).click();
  await expect(mediaUrl).toHaveValue(shareLink);
});

test("switches the metadata editor and settings without unmounting either panel", async ({
  page,
}) => {
  await uploadTrack(page);

  const editor = page.locator('[data-view="metadata-editor"]');
  const settings = page.locator('[data-view="settings"]');
  await expect(editor).toHaveAttribute("aria-hidden", "false");
  await expect(settings).toHaveAttribute("aria-hidden", "true");

  await page.getByRole("button", { name: "settings" }).click();
  await expect(editor).toHaveAttribute("aria-hidden", "true");
  await expect(settings).toHaveAttribute("aria-hidden", "false");

  await expect(editor).toHaveCSS("opacity", "0");
  await expect(settings).toHaveCSS("opacity", "1");
});

test("clicking blank space in the empty library closes settings", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "settings" }).click();
  await expect(page.getByRole("button", { name: "back to editor" })).toBeVisible();

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();

  await expect(page.getByRole("button", { name: "back to editor" })).not.toBeAttached();
  await expect(page.locator('[data-view="landing"]')).toBeVisible();
});

test("clicking blank space in a populated track list closes settings and clears the track", async ({
  page,
}) => {
  await uploadTrack(page);

  const editor = page.locator('[data-view="metadata-editor"]');
  const settings = page.locator('[data-view="settings"]');
  await page.getByRole("button", { name: "settings" }).click();
  await expect(settings).toHaveAttribute("aria-hidden", "false");

  await clickBlankTrackList(page);

  await expect(settings).toHaveAttribute("aria-hidden", "true");
  await expect(editor).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByRole("button", { name: /drop your audio here/ })).toBeVisible();
});

test("switches between the empty selection and track editor in both directions", async ({
  page,
}) => {
  await uploadTrack(page);
  await page.getByRole("button", { name: "settings" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /drop your audio here/ })).toBeVisible();
  await expect(page.locator('[data-editor-state="empty-selection"]')).toHaveCSS("opacity", "1");

  await getPopulatedTrackList(page).getByRole("button").first().click();
  await expect(page.getByRole("button", { name: "download track" })).toBeVisible();
  await expect(page.locator('[data-editor-state="loaded-track"]')).toHaveCSS("opacity", "1");

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();
  await expect(page.getByRole("button", { name: /drop your audio here/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();
});

for (const viewport of [
  { name: "mobile short", width: 390, height: 640 },
  { name: "medium", width: 900, height: 700 },
]) {
  test(`keeps empty-editor imports usable without overlap at ${viewport.name} size`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await uploadTrack(page);
    await page.getByRole("button", { name: "settings" }).focus();
    await page.keyboard.press("Escape");

    const dropzone = page.getByRole("button", { name: /drop your audio here/ });
    const urlEntry = page.locator('[data-layout="empty-editor"]');
    const urlInput = page.locator('input[name="media-url"]');
    await expect(dropzone).toBeVisible();
    await expect(dropzone).toBeEnabled();
    await expect(urlEntry).toBeVisible();
    await expect(urlInput).toBeEditable();
    await urlInput.fill("https://soundcloud.com/artist/track");
    await expect(urlInput).toHaveValue("https://soundcloud.com/artist/track");

    const dropzoneBox = await dropzone.boundingBox();
    const urlEntryBox = await urlEntry.boundingBox();
    if (!dropzoneBox || !urlEntryBox) {
      throw new Error("empty editor import bounds were not found");
    }
    expect(dropzoneBox.y + dropzoneBox.height).toBeLessThanOrEqual(urlEntryBox.y + 1);
  });
}

test("releases the loaded editor immediately when reduced motion is preferred", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await uploadTrack(page);

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();

  await expect(page.locator('[data-editor-state="empty-selection"]')).toHaveCSS("opacity", "1");
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();
});
