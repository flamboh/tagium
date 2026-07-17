import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";

const mp3Upload = (name: string) => {
  const bytes = new Uint8Array(834);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 417);
  return { name, mimeType: "audio/mpeg", buffer: Buffer.from(bytes) };
};

const openMobileLibrary = async (page: Page, filenames = ["mobile-track.mp3"]) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .setInputFiles(filenames.map((filename) => mp3Upload(filename)));
  await expect(page.getByText(`library (${filenames.length})`, { exact: true })).toBeVisible();
};

test("drills into a track and restores the list and focus with app or browser Back", async ({
  page,
}) => {
  await openMobileLibrary(page);
  const track = page.getByRole("button", { name: /mobile-track\.mp3/ }).first();

  await track.click();
  await expect(page.getByRole("button", { name: "library" })).toBeVisible();
  await expect(page.getByRole("button", { name: "library" })).toBeFocused();
  await page.getByRole("button", { name: "library" }).click();
  await expect(track).toBeVisible();
  await expect(track).toBeFocused();

  await track.click();
  await page.goBack();
  await expect(track).toBeVisible();
  await expect(track).toBeFocused();
});

test("reconciles mobile history across resize before another drill-in", async ({ page }) => {
  await openMobileLibrary(page);
  const track = page.getByRole("button", { name: /mobile-track\.mp3/ }).first();
  await track.click();

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole("button", { name: "download track" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 700 });
  await expect(track).toBeVisible();

  await track.click();
  await expect(page.getByRole("button", { name: "library" })).toBeFocused();
  await page.getByRole("button", { name: "library" }).click();
  await expect(track).toBeVisible();
});

test("reconciles mobile history when selection is cleared before reentering", async ({ page }) => {
  await openMobileLibrary(page);
  const track = page.getByRole("button", { name: /mobile-track\.mp3/ }).first();
  await track.click();
  await page.keyboard.press("Escape");
  await expect(track).toBeVisible();

  await track.click();
  await page.getByRole("button", { name: "library" }).click();
  await expect(track).toBeVisible();
});

test("selects another track from the accessible library sheet", async ({ page }) => {
  await openMobileLibrary(page, ["first-track.mp3", "second-track.mp3"]);
  await page
    .getByRole("button", { name: /first-track\.mp3/ })
    .first()
    .click();
  await page.getByRole("button", { name: "open library" }).click();

  const sheet = page.getByRole("dialog", { name: "library" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "close library" })).toBeFocused();
  await sheet
    .getByRole("button", { name: /second-track\.mp3/ })
    .first()
    .click();

  await expect(sheet).not.toBeVisible();
  await expect(page.getByText("second-track.mp3", { exact: true })).toBeVisible();

  const openLibrary = page.getByRole("button", { name: "open library" });
  await openLibrary.click();
  await sheet.getByRole("button", { name: "close library" }).click();
  await expect(openLibrary).toBeFocused();
});

test("opens settings as a mobile page and returns to the preserved library", async ({ page }) => {
  await openMobileLibrary(page);
  await page.getByRole("button", { name: "settings" }).click();
  await expect(page.getByRole("heading", { name: "settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "back to editor" })).toBeFocused();

  await page.getByRole("button", { name: "back to editor" }).click();
  await expect(page.getByText("library (1)", { exact: true })).toBeVisible();
});

test("preserves the exact library scroll position across track editing", async ({ page }) => {
  const filenames = Array.from({ length: 16 }, (_, index) => `scroll-track-${index + 1}.mp3`);
  await openMobileLibrary(page, filenames);
  const libraryScroller = page
    .getByText("library (16)", { exact: true })
    .locator("..")
    .locator("xpath=following-sibling::div[1]");
  await libraryScroller.evaluate((element) => {
    element.scrollTop = 260;
  });
  const scrollTop = await libraryScroller.evaluate((element) => element.scrollTop);

  await page
    .getByRole("button", { name: /scroll-track-12\.mp3/ })
    .first()
    .click();
  await page.getByRole("button", { name: "library" }).click();

  expect(await libraryScroller.evaluate((element) => element.scrollTop)).toBe(scrollTop);
});

test("returns to the library if the edited track is deleted from the sheet", async ({ page }) => {
  await openMobileLibrary(page);
  await page
    .getByRole("button", { name: /mobile-track\.mp3/ })
    .first()
    .click();
  await page.getByRole("button", { name: "open library" }).click();
  await page
    .getByRole("dialog", { name: "library" })
    .getByRole("button", {
      name: "remove track",
    })
    .click();
  await page
    .getByRole("dialog", { name: "remove track?" })
    .getByRole("button", { name: "remove track" })
    .click();

  await expect(page.getByRole("button", { name: /drop your mp3s here/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "library" })).not.toBeVisible();
});

test("discards a stale mobile history marker on reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  await page.evaluate(() => {
    const browserHistory = (
      globalThis as unknown as {
        history: { replaceState: (state: unknown, title: string) => void };
      }
    ).history;
    browserHistory.replaceState(
      { __tagiumMobileWorkspace: { token: "stale-session", page: "editor" } },
      "",
    );
  });
  await page.reload();

  await expect(page.getByRole("button", { name: /drop your mp3s here/ })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const browserHistory = (
        globalThis as unknown as { history: { state: Record<string, unknown> | null } }
      ).history;
      return Boolean(browserHistory.state?.__tagiumMobileWorkspace);
    }),
  ).toBe(false);
});

test("keeps settings reachable from the empty mobile landing screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  await page.getByRole("button", { name: "open library" }).click();
  await page
    .getByRole("dialog", { name: "library" })
    .getByRole("button", {
      name: "settings",
    })
    .click();

  await expect(page.getByRole("heading", { name: "settings" })).toBeVisible();
  await page.getByRole("button", { name: "back to editor" }).click();
  await expect(page.getByRole("button", { name: /drop your mp3s here/ })).toBeVisible();
});

test("keeps the desktop split workspace and controls unchanged", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(mp3Upload("desktop-track.mp3"));

  await expect(page.getByText("library (1)", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "download track" })).toBeVisible();
  await expect(page.getByRole("button", { name: "open library" })).not.toBeVisible();
});
