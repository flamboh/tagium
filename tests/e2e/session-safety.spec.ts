import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

const importTrack = async (page: Page) => {
  const mp3Bytes = new Uint8Array(834);
  mp3Bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  mp3Bytes.set([0xff, 0xfb, 0x90, 0x00], 417);

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "walk-away-track.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from(mp3Bytes),
  });
};

const uploadTrack = async (page: Page) => {
  await importTrack(page);
  await expect(page.getByRole("button", { name: /track actions for/ })).toBeAttached();
};

const requestTrackRemoval = async (page: Page) => {
  await page.getByRole("button", { name: /track actions for/ }).click();
  await page.getByRole("menuitem", { name: "remove track" }).click();
};

test("shows the native unload warning", async ({ page, browserName }) => {
  test.skip(
    browserName === "firefox",
    "Playwright cannot close Firefox with a beforeunload dialog",
  );
  await uploadTrack(page);

  const beforeUnload = new Promise<string>((resolve) => {
    page.once("dialog", async (dialog) => {
      resolve(dialog.type());
      await dialog.dismiss();
    });
  });

  await page.close({ runBeforeUnload: true });
  await expect(beforeUnload).resolves.toBe("beforeunload");
});

test("requires confirmation before removing an imported track", async ({ page }) => {
  await uploadTrack(page);

  await requestTrackRemoval(page);
  const confirmation = page.getByRole("dialog", { name: "remove track?" });
  await expect(confirmation).toBeVisible();

  await confirmation.getByRole("button", { name: "keep track" }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole("button", { name: /track actions for/ })).toBeAttached();

  await requestTrackRemoval(page);
  await confirmation.getByRole("button", { name: "remove track" }).click();
  await expect(page.getByText("no tracks yet", { exact: true })).toBeVisible();
});

test("keeps the selected track while deleting characters from its title", async ({ page }) => {
  await importTrack(page);
  const title = page.locator("#track-title");
  await expect(title).toBeVisible();
  await title.fill("track");
  await title.press("Home");

  await title.press("Delete");

  await expect(title).toHaveValue("rack");
  await expect(page.getByRole("dialog", { name: "remove track?" })).toBeHidden();
  await expect(page.getByText("library (1)", { exact: true })).toBeVisible();
});
