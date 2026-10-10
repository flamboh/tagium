import type { Page } from "@playwright/test";
import { audioFixture } from "../support/audio";
import { expect, test } from "./fixtures";

const TRACK = "Fixture Tone (mp3).mp3";

const uploadTrack = async (page: Page) => {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([audioFixture("mp3").upload]);
  await expect(page.getByLabel("title", { exact: true })).toHaveValue("Fixture Tone (mp3)");
};

const views = (page: Page) => ({
  editor: page.locator('[data-view="metadata-editor"]'),
  settings: page.locator('[data-view="settings"]'),
});

const expectActiveView = async (page: Page, active: "editor" | "settings") => {
  const { editor, settings } = views(page);
  await expect(active === "editor" ? editor : settings).toHaveAttribute("aria-hidden", "false");
  await expect(active === "editor" ? settings : editor).toHaveAttribute("aria-hidden", "true");
};

const workspaceNav = (page: Page) =>
  page.evaluate(
    () =>
      (history.state as { workspaceNav?: { kind?: string } } | null)?.workspaceNav?.kind ?? null,
  );

test("settings unmounts the media entry and back restores the url being typed", async ({
  page,
}) => {
  const shareLink = "https://tagium.app/share/abc234";
  await page.goto("/");
  const mediaUrl = page.getByRole("textbox", { name: "media url" });
  await mediaUrl.fill(shareLink);

  await page.getByRole("button", { name: "settings", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "settings sections" })).toBeVisible();
  await expect(mediaUrl).not.toBeAttached();

  await page.getByRole("button", { name: "back to workspace" }).click();
  await expect(mediaUrl).toHaveValue(shareLink);
});

test("settings is an exclusive destination and back returns to the edited track", async ({
  page,
}) => {
  await uploadTrack(page);
  const { editor } = views(page);
  await page.getByLabel("title", { exact: true }).fill("Restored after settings");

  await page.getByRole("button", { name: "settings", exact: true }).click();
  await expectActiveView(page, "settings");
  await expect(editor).toHaveAttribute("inert", "");

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expectActiveView(page, "settings");
  await expect(page.getByRole("dialog")).not.toBeAttached();

  await page.getByRole("button", { name: "back to workspace" }).click();
  await expectActiveView(page, "editor");
  await expect(page.getByLabel("title", { exact: true })).toHaveValue("Restored after settings");
});

test("the tagium nameplate goes home without discarding library work", async ({ page }) => {
  await uploadTrack(page);
  await page.getByLabel("title", { exact: true }).fill("Preserved by home");

  await page.getByRole("button", { name: "tagium, go to workspace home" }).click();
  await expect(page.getByText("library (1)", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();

  await page.getByRole("button", { name: "Preserved by home.mp3", exact: true }).click();
  await expect(page.getByLabel("title", { exact: true })).toHaveValue("Preserved by home");
});

test("selecting a track while in settings opens it in the editor", async ({ page }) => {
  await uploadTrack(page);
  await page.getByRole("button", { name: "settings", exact: true }).click();
  await expectActiveView(page, "settings");

  await page.getByRole("button", { name: TRACK, exact: true }).click();
  await expectActiveView(page, "editor");
  await expect(page.getByRole("button", { name: "download track" })).toBeVisible();
});

test("clicking blank library space leaves settings for the landing page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "back to workspace" })).toBeVisible();

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();
  await expect(page.getByRole("button", { name: "back to workspace" })).not.toBeAttached();
  await expect(page.locator('[data-view="landing"]')).toBeVisible();
});

test("clearing the selection and reselecting a track switch the editor both ways", async ({
  page,
}) => {
  await uploadTrack(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /drop your audio here/u })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "media url" })).toBeEditable();

  await page.getByRole("button", { name: TRACK, exact: true }).click();
  await expect(page.getByRole("button", { name: "download track" })).toBeVisible();

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();
  await expect(page.getByRole("button", { name: /drop your audio here/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();
});

test("reduced motion releases the editor immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await uploadTrack(page);
  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();
  await expect(page.getByRole("button", { name: /drop your audio here/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 700 } });

  test("settings shows the library button beside an unobstructed back button", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "open library" }).click();
    await page
      .getByRole("dialog", { name: "library" })
      .getByRole("button", { name: "settings" })
      .click();

    const back = page.getByRole("button", { name: "back to workspace" });
    const opener = page.getByRole("button", { name: "open library" });
    const [backBox, openerBox] = [(await back.boundingBox())!, (await opener.boundingBox())!];
    expect(openerBox.x + openerBox.width).toBeLessThanOrEqual(backBox.x);
    await back.click();
    await expect(page.getByRole("button", { name: "back to workspace" })).not.toBeAttached();
    await expect.poll(() => workspaceNav(page)).toBeNull();
  });

  test("drawer navigation and browser back leave settings without stale history", async ({
    page,
  }) => {
    await uploadTrack(page);
    const openLibrary = page.getByRole("button", { name: "open library" });
    const drawer = page.getByRole("dialog", { name: "library" });

    await openLibrary.click();
    await drawer.getByRole("button", { name: "settings" }).click();
    await expectActiveView(page, "settings");
    await expect.poll(() => workspaceNav(page)).toBe("view");

    await openLibrary.click();
    await drawer.getByRole("button", { name: TRACK, exact: true }).click();
    await expect(drawer).not.toBeAttached();
    await expectActiveView(page, "editor");
    await expect.poll(() => workspaceNav(page)).toBeNull();

    await openLibrary.click();
    await drawer.getByRole("button", { name: "settings" }).click();
    await expectActiveView(page, "settings");
    await openLibrary.click();
    await page.getByRole("button", { name: "tagium, go to workspace home" }).click();
    await expect(drawer).not.toBeAttached();
    await expect.poll(() => workspaceNav(page)).toBeNull();
    await expectActiveView(page, "editor");

    await openLibrary.click();
    await drawer.getByRole("button", { name: "settings" }).click();
    await expectActiveView(page, "settings");
    await page.goBack();
    await expectActiveView(page, "editor");
    await expect.poll(() => workspaceNav(page)).toBeNull();
    await expect(page.getByText("library (1)", { exact: true })).toBeAttached();
  });
});
