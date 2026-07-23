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

test("download confirmation owns focus, dismisses safely, and restores its trigger", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(mp3Upload("focus-track.mp3"));
  const trigger = downloadAllButton(page);
  await expect(trigger).toBeAttached();
  await expect(trigger).toBeEnabled();

  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Download 1 track" });
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

test("download contents scroll inside a constrained mobile dialog", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 240 });
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .setInputFiles(Array.from({ length: 18 }, (_, index) => mp3Upload(`track-${index + 1}.mp3`)));
  await page.getByRole("button", { name: "open library" }).click();
  await expect(page.locator("[data-mobile-drawer]")).toHaveAttribute("data-mobile-drawer", "open");
  const library = page.getByRole("dialog", { name: "library" });
  const trigger = library.getByRole("button", { name: "download all", exact: true });
  await expect(trigger).toBeAttached();
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Download 18 tracks" });
  await expect(page.locator("[data-mobile-drawer]")).toHaveAttribute(
    "data-mobile-drawer",
    "closed",
  );
  await expect(library).not.toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /18 tracks$/ }).click();

  const summary = dialog.getByTestId("export-summary");
  await expect(summary).toBeVisible();
  const summaryMetrics = await summary.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(summaryMetrics.clientHeight).toBeGreaterThan(0);
  expect(summaryMetrics.scrollHeight).toBeGreaterThan(summaryMetrics.clientHeight);
  await expect(dialog.getByRole("button", { name: "cancel" })).toBeVisible();
  await dialog.getByRole("button", { name: "cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "open library" })).toBeFocused();
});
