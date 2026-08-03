import { Buffer } from "node:buffer";
import { expect, type Page, test } from "@playwright/test";

const mp3Upload = (name: string) => {
  const bytes = new Uint8Array(834);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 417);
  return { name, mimeType: "audio/mpeg", buffer: Buffer.from(bytes) };
};

const downloadAllButton = (page: Page) =>
  page.getByRole("button", { name: "download all", exact: true });

test("bulk download confirmation owns focus, dismisses safely, and restores its trigger", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(mp3Upload("focus-track.mp3"));
  const trigger = downloadAllButton(page);
  await expect(trigger).toBeEnabled();

  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Download 1 track" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("only the manifest scrolls in a constrained mobile dialog", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 240 });
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .setInputFiles(Array.from({ length: 18 }, (_, index) => mp3Upload(`track-${index + 1}.mp3`)));
  const menuButton = page.getByRole("button", { name: "open library" });
  await menuButton.click();
  const drawer = page.getByRole("dialog", { name: "library" });
  await expect(drawer).toBeVisible();
  await downloadAllButton(page).click();
  await expect(drawer).toBeHidden();
  const dialog = page.getByRole("dialog", { name: "Download 18 tracks" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Loose tracks 18 tracks" }).click();

  const manifest = dialog.getByTestId("export-manifest");
  const metrics = await manifest.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(metrics.clientHeight).toBeGreaterThan(0);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Download ~/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(menuButton).toBeFocused();
});
