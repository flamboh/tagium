import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";

const uploadTrack = async (page: Page) => {
  const mp3Bytes = new Uint8Array(834);
  mp3Bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  mp3Bytes.set([0xff, 0xfb, 0x90, 0x00], 417);

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "walk-away-track.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from(mp3Bytes),
  });
  await expect(page.getByRole("button", { name: "remove track" })).toBeAttached();
};

test("prevents unloading a session with imported tracks", async ({ page }) => {
  await uploadTrack(page);

  const unloadWasPrevented = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    const browserGlobal = globalThis as unknown as EventTarget;
    return {
      dispatchResult: browserGlobal.dispatchEvent(event),
      defaultPrevented: event.defaultPrevented,
    };
  });

  expect(unloadWasPrevented).toEqual({
    dispatchResult: false,
    defaultPrevented: true,
  });
});

test("allows unloading an empty session", async ({ page }) => {
  await page.goto("/");

  const unloadWasPrevented = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    const browserGlobal = globalThis as unknown as EventTarget;
    return {
      dispatchResult: browserGlobal.dispatchEvent(event),
      defaultPrevented: event.defaultPrevented,
    };
  });

  expect(unloadWasPrevented).toEqual({
    dispatchResult: true,
    defaultPrevented: false,
  });
});

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

  await page.getByRole("button", { name: "remove track" }).click();
  const confirmation = page.getByRole("dialog", { name: "remove track?" });
  await expect(confirmation).toBeVisible();

  await confirmation.getByRole("button", { name: "keep track" }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole("button", { name: "remove track" })).toBeAttached();

  await page.getByRole("button", { name: "remove track" }).click();
  await confirmation.getByRole("button", { name: "remove track" }).click();
  await expect(page.getByText("no tracks yet", { exact: true })).toBeVisible();
});
