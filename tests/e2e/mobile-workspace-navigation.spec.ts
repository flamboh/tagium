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

const dispatchTouchSwipe = async (
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) => {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...from, id: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...to, id: 1 }],
  });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
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
  await expect(page.getByRole("button", { name: "close library" })).toHaveCount(1);
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
  await expect(main).not.toHaveAttribute("inert");
  await expect(main.locator("[data-mobile-main-content]")).toHaveAttribute("inert", "");
  const drawerWidth = await drawer.evaluate((element) => element.getBoundingClientRect().width);
  await expect
    .poll(async () =>
      Math.round(await main.evaluate((element) => element.getBoundingClientRect().left)),
    )
    .toBe(Math.round(drawerWidth));
});

test("opens and closes from coordinate-bounded touch start zones", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP touch injection is Chromium-only");
  await openMobileApp(page);
  const main = page.locator("[data-mobile-main-surface]");
  await expect(main).toHaveCSS("touch-action", "auto");

  await dispatchTouchSwipe(page, { x: 24, y: 200 }, { x: 96, y: 204 });
  await expect(page.getByRole("dialog", { name: "library" })).not.toBeVisible();
  await dispatchTouchSwipe(page, { x: 96, y: 200 }, { x: 176, y: 204 });
  await expect(page.getByRole("dialog", { name: "library" })).toBeVisible();

  await expect.poll(async () => Math.round((await main.boundingBox())?.x ?? 0)).toBe(320);
  await dispatchTouchSwipe(page, { x: 330, y: 200 }, { x: 330, y: 280 });
  await expect(page.getByRole("dialog", { name: "library" })).toBeVisible();
  await dispatchTouchSwipe(page, { x: 330, y: 200 }, { x: 350, y: 200 });
  await expect(page.getByRole("dialog", { name: "library" })).toBeVisible();
  await dispatchTouchSwipe(page, { x: 330, y: 200 }, { x: 250, y: 204 });
  await expect(page.getByRole("dialog", { name: "library" })).not.toBeVisible();

  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByRole("button", { name: "open library" }).click();
  await expect(page.getByRole("dialog", { name: "library" })).toBeVisible();
  await expect.poll(async () => Math.round((await main.boundingBox())?.x ?? 0)).toBe(282);
  await dispatchTouchSwipe(page, { x: 290, y: 200 }, { x: 210, y: 204 });
  await expect(page.getByRole("dialog", { name: "library" })).not.toBeVisible();
});

test("ignores mouse drags and keeps the desktop surface native", async ({ page }) => {
  await openMobileApp(page);
  await page.mouse.move(24, 200);
  await page.mouse.down();
  await page.mouse.move(96, 204);
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "library" })).not.toBeVisible();
  await page.setViewportSize({ width: 800, height: 768 });
  await expect(page.locator("[data-mobile-main-surface]")).toHaveCSS("touch-action", "auto");
  await expect(page.locator("[data-mobile-drawer]")).toHaveAttribute(
    "data-mobile-drawer",
    "closed",
  );
});

test("keeps the editor primary and closes the drawer when a track is selected", async ({
  page,
}) => {
  await openMobileApp(page);
  await page.locator('input[type="file"]').setInputFiles(mp3Upload("mobile-track.mp3"));

  await expect(page.getByRole("button", { name: "download track" })).toBeVisible();
  await expect(page.getByRole("button", { name: "open library" })).toHaveCount(1);
  await expect(page.locator("[data-mobile-opener-layer]")).toHaveCSS("display", "block");
  await expect(page.locator("[data-mobile-opener-layer]")).toHaveCSS("position", "absolute");
  await expect(page.locator("[data-mobile-opener-layer]")).toHaveCSS("z-index", "20");
  await expect(page.locator("[data-mobile-opener-layer]")).not.toHaveCSS("transform", "none");
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

test("closes when the exposed main canvas is pressed and restores opener focus", async ({
  page,
}) => {
  await openMobileApp(page);
  const opener = page.getByRole("button", { name: "open library" });
  await opener.click();

  const main = page.locator("[data-mobile-main-surface]");
  await main.click({ position: { x: 20, y: 350 } });

  await expect(page.getByRole("dialog", { name: "library" })).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test("closes with the close button and restores focus to the single opener", async ({ page }) => {
  await openMobileApp(page);
  const opener = page.getByRole("button", { name: "open library" });
  await opener.click();
  await page.getByRole("button", { name: "close library" }).click();

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
