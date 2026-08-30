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
  await expect(page.locator('[data-layout="editor"]')).toBeVisible();
};

const getPopulatedTrackList = (page: Page) => {
  const libraryHeader = page.getByText("library (1)", { exact: true });
  return libraryHeader.locator("..").locator("xpath=following-sibling::div[1]");
};

const clearSelectionWithEscape = async (page: Page) => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
};

test("unmounts the media entry in settings and restores its source URL", async ({ page }) => {
  const shareLink = "https://tagium.app/share/abcdefghijklmnopqrstuv";
  await page.goto("/");
  const mediaUrl = page.locator('input[name="media-url"]');
  await mediaUrl.fill(shareLink);

  await page.getByRole("button", { name: "settings", exact: true }).click();
  await expect(mediaUrl).not.toBeAttached();

  await page.getByRole("button", { name: "back to workspace" }).click();
  await expect(mediaUrl).toHaveValue(shareLink);
});

test("persists link changes made through the settings switch", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "settings" }).click();
  await page.getByRole("button", { name: "linking", exact: true }).click();

  const artistLink = page.getByRole("switch", {
    name: "sync artist with the album artist",
  });
  await expect(artistLink).toHaveAttribute("aria-checked", "true");
  await artistLink.click();
  await expect(artistLink).toHaveAttribute("aria-checked", "false");

  await page.getByRole("button", { name: "back to workspace" }).click();
  await page.reload();
  await page.getByRole("button", { name: "settings" }).click();
  await page.getByRole("button", { name: "linking", exact: true }).click();
  await expect(artistLink).toHaveAttribute("aria-checked", "false");
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
});

test("treats settings as an exclusive destination and Back restores the selected track", async ({
  page,
}) => {
  await uploadTrack(page);
  const editor = page.locator('[data-view="metadata-editor"]');
  const settings = page.locator('[data-view="settings"]');
  await page.locator("#track-title").fill("Restored after settings");

  await page.getByRole("button", { name: "settings", exact: true }).click();

  await expect(settings).toHaveAttribute("aria-hidden", "false");
  await expect(editor).toHaveAttribute("aria-hidden", "true");
  await expect(editor).toHaveAttribute("inert", "");

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect(settings).toHaveAttribute("aria-hidden", "false");

  await page.getByRole("button", { name: "back to workspace" }).click();

  await expect(settings).toHaveAttribute("aria-hidden", "true");
  await expect(editor).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#track-title")).toHaveValue("Restored after settings");
});

test("uses the tagium nameplate as Home without discarding library work", async ({ page }) => {
  await uploadTrack(page);
  const title = page.locator("#track-title");
  await title.fill("Preserved by Home");

  await page.getByRole("button", { name: "tagium, go to workspace home" }).click();

  await expect(page.getByText("library (1)", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();

  await getPopulatedTrackList(page).getByRole("button").first().click();
  await expect(title).toHaveValue("Preserved by Home");
});

test("selecting a track from settings activates that editor destination", async ({ page }) => {
  await uploadTrack(page);
  await page.getByRole("button", { name: "settings" }).click();

  await getPopulatedTrackList(page).getByRole("button").first().click();

  await expect(page.locator('[data-view="settings"]')).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator('[data-view="metadata-editor"]')).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await expect(page.getByRole("button", { name: "download track" })).toBeVisible();
});

test("mobile sidebar actions leave settings and its history entry before navigating", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await uploadTrack(page);

  const openLibrary = page.getByRole("button", { name: "open library" });
  await openLibrary.click();
  await page
    .getByRole("dialog", { name: "library" })
    .getByRole("button", { name: "settings" })
    .click();
  await expect(page.locator('[data-view="settings"]')).toHaveAttribute("aria-hidden", "false");

  await openLibrary.click();
  await getPopulatedTrackList(page).getByRole("button").first().click();
  await expect(page.locator('[data-view="metadata-editor"]')).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  expect(
    await page.evaluate(
      () =>
        (history.state as { workspaceNav?: { kind?: string } } | null)?.workspaceNav?.kind ?? null,
    ),
  ).toBeNull();

  await openLibrary.click();
  await page
    .getByRole("dialog", { name: "library" })
    .getByRole("button", { name: "settings" })
    .click();
  await expect(page.locator('[data-view="settings"]')).toHaveAttribute("aria-hidden", "false");

  await openLibrary.click();
  await page.getByRole("button", { name: "tagium, go to workspace home" }).click();
  expect(
    await page.evaluate(
      () =>
        (history.state as { workspaceNav?: { kind?: string } } | null)?.workspaceNav?.kind ?? null,
    ),
  ).toBeNull();
});

test("clicking blank space in the empty library closes settings", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "settings" }).click();
  await expect(page.getByRole("button", { name: "back to workspace" })).toBeVisible();

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();

  await expect(page.getByRole("button", { name: "back to workspace" })).not.toBeAttached();
  await expect(page.locator('[data-view="landing"]')).toBeVisible();
});

test("switches between the empty selection and track editor in both directions", async ({
  page,
}) => {
  await uploadTrack(page);
  await clearSelectionWithEscape(page);
  await expect(page.getByRole("button", { name: /drop your audio here/ })).toBeVisible();
  await expect(page.locator('input[name="media-url"]')).toBeEditable();
  await expect(page.getByText("or import from a url", { exact: true })).not.toBeAttached();

  await getPopulatedTrackList(page).getByRole("button").first().click();
  await expect(page.getByRole("button", { name: "download track" })).toBeVisible();

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();
  await expect(page.getByRole("button", { name: /drop your audio here/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();
});

test("releases the loaded editor immediately when reduced motion is preferred", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await uploadTrack(page);

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();

  await expect(page.getByRole("button", { name: /drop your audio here/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();
});

test("toggles advanced metadata from the entire setting row exactly once", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "settings" }).click();
  await page.getByRole("button", { name: "editing", exact: true }).click();

  const advancedSetting = page.getByRole("checkbox", { name: "show advanced fields" });
  const advancedSettingRow = page.locator("label").filter({ hasText: "show advanced fields" });
  await advancedSettingRow.click();
  await expect(advancedSetting).toBeChecked();

  await advancedSetting.click();
  await expect(advancedSetting).not.toBeChecked();
});

test("gates advanced fields, retains their values, and reveals hidden validation", async ({
  page,
}) => {
  await uploadTrack(page);
  await page.locator("#track-title").fill("Advanced track");
  await page.getByRole("button", { name: "settings" }).click();
  await page.getByRole("button", { name: "editing", exact: true }).click();

  const advancedSetting = page.getByRole("checkbox", { name: "show advanced fields" });
  await expect(advancedSetting).not.toBeChecked();
  await page.getByRole("button", { name: "linking", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "sync album artist with the track artist" }),
  ).not.toBeAttached();

  await page.getByRole("button", { name: "editing", exact: true }).click();
  await advancedSetting.click();
  await page.getByRole("button", { name: "linking", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "sync album artist with the track artist" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "back to workspace" }).click();

  await expect(page.getByRole("group", { name: "metadata fields" })).toBeVisible();
  await page.getByRole("button", { name: "advanced", exact: true }).click();
  await page.locator("#track-composer").fill("Retained composer");
  await page.locator("#track-disc-number").fill("0");
  await page.getByRole("button", { name: "normal", exact: true }).click();
  await page.getByRole("button", { name: "download track" }).click();

  await expect(page.getByRole("button", { name: "advanced", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#track-disc-number")).toBeFocused();
  await expect(page.locator("#track-disc-number-error")).toBeVisible();
  await expect(page.locator("#track-composer")).toHaveValue("Retained composer");

  await page.getByRole("button", { name: "settings" }).click();
  await page.getByRole("button", { name: "editing", exact: true }).click();
  await advancedSetting.click();
  await page.getByRole("button", { name: "back to workspace" }).click();
  await expect(page.getByRole("group", { name: "metadata fields" })).not.toBeAttached();

  await page.getByRole("button", { name: "settings" }).click();
  await page.getByRole("button", { name: "editing", exact: true }).click();
  await advancedSetting.click();
  await page.getByRole("button", { name: "back to workspace" }).click();
  await expect(page.getByRole("button", { name: "advanced", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#track-composer")).toHaveValue("Retained composer");
});
