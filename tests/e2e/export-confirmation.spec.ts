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
  const dialog = page.getByRole("dialog", { name: "download 1 track" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "cancel" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
