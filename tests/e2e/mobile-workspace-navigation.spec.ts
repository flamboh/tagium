import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";

const mp3Upload = (name: string) => {
  const bytes = new Uint8Array(834);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 417);
  return { name, mimeType: "audio/mpeg", buffer: Buffer.from(bytes) };
};

const openMobileApp = async (page: Page) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
};

test("lands on the download surface with one push-drawer opener", async ({ page }) => {
  await openMobileApp(page);

  await expect(page.getByRole("button", { name: /drop your mp3s here/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "open library" })).toHaveCount(1);
  await expect(page.locator("[data-mobile-drawer]")).toHaveAttribute(
    "data-mobile-drawer",
    "closed",
  );

  await page.getByRole("button", { name: "open library" }).click();
  const drawer = page.getByRole("dialog", { name: "library" });
  const main = page.locator("[data-mobile-main-surface]");

  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: "close library" })).toBeFocused();
  const shell = page.locator("[data-mobile-drawer]");
  await expect(shell.locator(":scope > *")).toHaveCount(2);
  await expect(
    shell.locator(":scope > :not([data-mobile-library]):not([data-mobile-main-surface])"),
  ).toHaveCount(0);
  await expect(drawer).toHaveCSS("transition-duration", "0.2s");
  await expect(drawer).toHaveCSS("transition-property", /transform/);
  await expect(main).toHaveCSS("transition-duration", "0.2s");
  await expect(main).toHaveCSS("transition-property", /transform/);
  const drawerWidth = await drawer.evaluate((element) => element.getBoundingClientRect().width);
  await expect
    .poll(async () =>
      Math.round(await main.evaluate((element) => element.getBoundingClientRect().left)),
    )
    .toBe(Math.round(drawerWidth));
});

test("keeps the editor primary and closes the drawer when a track is selected", async ({
  page,
}) => {
  await openMobileApp(page);
  await page.locator('input[type="file"]').setInputFiles(mp3Upload("mobile-track.mp3"));

  await expect(page.getByRole("button", { name: "download track" })).toBeVisible();
  await expect(page.getByRole("button", { name: "open library" })).toHaveCount(1);
  await page.getByRole("button", { name: "open library" }).click();
  const drawer = page.getByRole("dialog", { name: "library" });
  await drawer
    .getByRole("button", { name: /\.mp3$/ })
    .first()
    .click();

  await expect(drawer).not.toBeVisible();
  await expect(page.locator("[data-mobile-drawer]")).toHaveAttribute(
    "data-mobile-drawer",
    "closed",
  );
  await expect(page.getByRole("button", { name: "download track" })).toBeVisible();
});

test("reaches settings from the empty drawer and returns to download", async ({ page }) => {
  await openMobileApp(page);
  await page.getByRole("button", { name: "open library" }).click();
  await page
    .getByRole("dialog", { name: "library" })
    .getByRole("button", { name: "settings" })
    .click();

  await expect(page.getByRole("heading", { name: "settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "open library" })).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "library" })).not.toBeVisible();
  await page.getByRole("button", { name: "back to editor" }).click();
  await expect(page.getByRole("button", { name: /drop your mp3s here/ })).toBeVisible();
});

test("closes on Escape and restores focus to the single opener", async ({ page }) => {
  await openMobileApp(page);
  const opener = page.getByRole("button", { name: "open library" });
  await opener.click();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog", { name: "library" })).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test("restores focus when removing the final track closes the drawer", async ({ page }) => {
  await openMobileApp(page);
  await page.locator('input[type="file"]').setInputFiles(mp3Upload("last-track.mp3"));
  const opener = page.getByRole("button", { name: "open library" });
  await opener.click();
  await page
    .getByRole("dialog", { name: "library" })
    .getByRole("button", { name: "remove track" })
    .click();
  await page
    .getByRole("dialog", { name: "remove track?" })
    .getByRole("button", { name: "remove track" })
    .click();

  await expect(page.getByRole("button", { name: /drop your mp3s here/ })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "library" })).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test("keeps the tablet split layout and reconciles drawer focus across resize", async ({
  page,
}) => {
  await openMobileApp(page);
  await page.locator('input[type="file"]').setInputFiles(mp3Upload("tablet-track.mp3"));
  await page.getByRole("button", { name: "open library" }).click();
  await page.setViewportSize({ width: 800, height: 768 });

  await expect(page.locator('[data-mobile-library="library"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "open library" })).not.toBeVisible();
  await expect(page.locator("[data-mobile-main-surface]")).toHaveCSS("transform", "none");
  await expect(page.locator('[data-mobile-library="library"] button:focus')).toHaveCount(1);
  await expect
    .poll(async () =>
      Math.round(
        await page
          .locator('[data-view="metadata-editor"] h2')
          .evaluate((element) => element.getBoundingClientRect().left),
      ),
    )
    .toBe(304);

  await page.setViewportSize({ width: 390, height: 700 });
  await expect(page.locator("[data-mobile-drawer]")).toHaveAttribute(
    "data-mobile-drawer",
    "closed",
  );
  await expect(page.getByRole("dialog", { name: "library" })).not.toBeVisible();
});
