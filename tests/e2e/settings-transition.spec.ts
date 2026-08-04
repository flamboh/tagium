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

const clickBlankTrackList = async (page: Page) => {
  const trackList = getPopulatedTrackList(page);
  await expect(trackList).toBeVisible();

  const bounds = await trackList.boundingBox();
  if (!bounds) throw new Error("populated track list bounds were not found");

  await trackList.click({
    position: { x: bounds.width / 2, y: bounds.height - 8 },
  });
};

const clearSelectionWithEscape = async (page: Page) => {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Escape");
};

test("moves the media URL entry continuously from landing to editor", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const mediaUrlForm = page.locator('form:has(input[name="media-url"])');
  await expect(mediaUrlForm).toBeVisible();
  const landingBox = await mediaUrlForm.boundingBox();
  if (!landingBox) throw new Error("landing media URL form bounds were not found");

  await page.evaluate(() => {
    const motionWindow = window as Window & {
      __mediaUrlMotionElement?: Element | null;
      __mediaUrlMotionSamples?: Array<{ width: number; x: number; y: number }>;
    };
    const samples: Array<{ width: number; x: number; y: number }> = [];
    motionWindow.__mediaUrlMotionElement = document.querySelector('input[name="media-url"]');
    motionWindow.__mediaUrlMotionSamples = samples;
    const deadline = performance.now() + 1_000;
    const sample = () => {
      const form = document.querySelector('input[name="media-url"]')?.closest("form");
      if (form) {
        const rect = form.getBoundingClientRect();
        samples.push({ width: rect.width, x: rect.x, y: rect.y });
      }
      if (performance.now() < deadline) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  const mp3Bytes = new Uint8Array(834);
  mp3Bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  mp3Bytes.set([0xff, 0xfb, 0x90, 0x00], 417);
  await page.locator('input[type="file"]').setInputFiles({
    name: "shared-element-track.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from(mp3Bytes),
  });
  await expect(page.locator('[data-layout="editor"]')).toBeVisible();
  await page.waitForTimeout(1_000);

  const editorBox = await mediaUrlForm.boundingBox();
  if (!editorBox) throw new Error("editor media URL form bounds were not found");
  const samples = await page.evaluate(
    () =>
      (
        window as Window & {
          __mediaUrlMotionSamples?: Array<{ width: number; x: number; y: number }>;
        }
      ).__mediaUrlMotionSamples ?? [],
  );
  const preservedElement = await page.evaluate(
    () =>
      (window as Window & { __mediaUrlMotionElement?: Element }).__mediaUrlMotionElement ===
      document.querySelector('input[name="media-url"]'),
  );
  const minY = Math.min(landingBox.y, editorBox.y);
  const maxY = Math.max(landingBox.y, editorBox.y);

  expect(maxY - minY).toBeGreaterThan(20);
  expect(preservedElement).toBe(true);
  expect(samples.some((sample) => sample.y > minY + 1 && sample.y < maxY - 1)).toBe(true);
});

test("unmounts the media entry in settings and restores its source URL", async ({ page }) => {
  const shareLink = "https://tagium.app/share/abcdefghijklmnopqrstuv";
  await page.goto("/");
  const mediaUrl = page.locator('input[name="media-url"]');
  await mediaUrl.fill(shareLink);

  await page.getByRole("button", { name: "settings" }).click();
  await expect(mediaUrl).not.toBeAttached();

  await page.getByRole("button", { name: "back to workspace" }).click();
  await expect(mediaUrl).toHaveValue(shareLink);
});

test("prevents checkbox label text selection", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "settings" }).click();

  const checkboxLabel = page
    .getByText("automatically apply soundcloud album cover to all tracks", {
      exact: true,
    })
    .locator("..");

  await expect(checkboxLabel).toHaveCSS("user-select", "none");
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

  await expect(editor).toHaveCSS("opacity", "0");
  await expect(settings).toHaveCSS("opacity", "1");
});

test("treats settings as an exclusive destination and Back restores the selected track", async ({
  page,
}) => {
  await uploadTrack(page);
  const editor = page.locator('[data-view="metadata-editor"]');
  const settings = page.locator('[data-view="settings"]');
  const track = getPopulatedTrackList(page).getByRole("button").first();
  await page.locator("#track-title").fill("Restored after settings");

  expect(await track.evaluate((element) => element.classList.contains("bg-accent"))).toBe(true);
  await page.getByRole("button", { name: "settings" }).click();

  await expect(settings).toHaveAttribute("aria-hidden", "false");
  await expect(editor).toHaveAttribute("aria-hidden", "true");
  await expect(editor).toHaveAttribute("inert", "");
  expect(await track.evaluate((element) => element.classList.contains("bg-accent"))).toBe(false);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await expect(settings).toHaveAttribute("aria-hidden", "false");

  await page.getByRole("button", { name: "back to workspace" }).click();

  await expect(settings).toHaveAttribute("aria-hidden", "true");
  await expect(editor).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator("#track-title")).toHaveValue("Restored after settings");
  expect(await track.evaluate((element) => element.classList.contains("bg-accent"))).toBe(true);
});

test("uses the tagium nameplate as Home without discarding library work", async ({ page }) => {
  await uploadTrack(page);
  const title = page.locator("#track-title");
  await title.fill("Preserved by Home");

  await page.getByRole("button", { name: "tagium, go to workspace home" }).click();

  await expect(page.getByText("library (1)", { exact: true })).toBeVisible();
  await expect(page.locator('[data-editor-state="empty-selection"]')).toHaveCSS("opacity", "1");
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();

  await getPopulatedTrackList(page).getByRole("button").first().click();
  await expect(title).toHaveValue("Preserved by Home");
});

test("goes directly from settings Home to the neutral editor without a nested track fade", async ({
  page,
}) => {
  await uploadTrack(page);
  await page.getByRole("button", { name: "settings" }).click();

  await page.getByRole("button", { name: "tagium, go to workspace home" }).click();
  await expect(page.locator('[data-view="settings"]')).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator('[data-view="metadata-editor"]')).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  const animatedEditorStates = await page
    .locator('[data-editor-state="empty-selection"], [data-editor-state="loaded-track"]')
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.getAnimations().length > 0)
        .map((element) => element.getAttribute("data-editor-state")),
    );

  expect(animatedEditorStates).toEqual([]);
  await expect(page.locator('[data-editor-state="empty-selection"]')).toHaveCSS("opacity", "1");
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
  await expect(page.locator('[data-editor-state="empty-selection"]')).toHaveCSS("opacity", "1");
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

test("clicking blank space in a populated track list closes settings and clears the track", async ({
  page,
}) => {
  await uploadTrack(page);

  const editor = page.locator('[data-view="metadata-editor"]');
  const settings = page.locator('[data-view="settings"]');
  await page.getByRole("button", { name: "settings" }).click();
  await expect(settings).toHaveAttribute("aria-hidden", "false");

  await clickBlankTrackList(page);

  await expect(settings).toHaveAttribute("aria-hidden", "true");
  await expect(editor).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByRole("button", { name: /drop your audio here/ })).toBeVisible();
});

test("switches between the empty selection and track editor in both directions", async ({
  page,
}) => {
  await uploadTrack(page);
  await clearSelectionWithEscape(page);
  await expect(page.getByRole("button", { name: /drop your audio here/ })).toBeVisible();
  await expect(page.locator('input[name="media-url"]')).toBeEditable();
  await expect(page.getByText("or import from a url", { exact: true })).not.toBeAttached();
  await expect(page.locator('[data-editor-state="empty-selection"]')).toHaveCSS("opacity", "1");

  await getPopulatedTrackList(page).getByRole("button").first().click();
  await expect(page.getByRole("button", { name: "download track" })).toBeVisible();
  await expect(page.locator('[data-editor-state="loaded-track"]')).toHaveCSS("opacity", "1");

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();
  await expect(page.getByRole("button", { name: /drop your audio here/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();
});

for (const viewport of [
  { name: "mobile short", width: 390, height: 640 },
  { name: "medium", width: 900, height: 700 },
]) {
  test(`keeps the media bar stable and usable at ${viewport.name} size`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await uploadTrack(page);
    const selectedUrlForm = page.locator('[data-layout="editor"] form');
    await expect(selectedUrlForm).toBeVisible();
    await expect
      .poll(() =>
        selectedUrlForm.evaluate((form) => form.parentElement?.getAnimations().length ?? 0),
      )
      .toBe(0);
    const selectedUrlFormBox = await selectedUrlForm.boundingBox();
    await clearSelectionWithEscape(page);

    const dropzone = page.getByRole("button", { name: /drop your audio here/ });
    const urlEntry = page.locator('[data-layout="empty-editor"]');
    const emptyUrlForm = urlEntry.locator("form");
    const urlInput = page.locator('input[name="media-url"]');
    await expect(dropzone).toBeVisible();
    await expect(dropzone).toBeEnabled();
    await expect(urlEntry).toBeVisible();
    await expect(emptyUrlForm).toBeVisible();
    await expect
      .poll(() => emptyUrlForm.evaluate((form) => form.parentElement?.getAnimations().length ?? 0))
      .toBe(0);
    const emptyUrlFormBox = await emptyUrlForm.boundingBox();
    await expect(urlInput).toBeEditable();
    await expect(page.getByText("or import from a url", { exact: true })).not.toBeAttached();
    await urlInput.fill("https://soundcloud.com/artist/track");
    await expect(urlInput).toHaveValue("https://soundcloud.com/artist/track");

    const dropzoneBox = await dropzone.boundingBox();
    const urlEntryBox = await urlEntry.boundingBox();
    if (!dropzoneBox || !urlEntryBox || !selectedUrlFormBox || !emptyUrlFormBox) {
      throw new Error("empty editor import bounds were not found");
    }
    expect(dropzoneBox.y + dropzoneBox.height).toBeLessThanOrEqual(urlEntryBox.y + 1);
    expect(emptyUrlFormBox.width).toBeCloseTo(selectedUrlFormBox.width, 5);
  });
}

test("releases the loaded editor immediately when reduced motion is preferred", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await uploadTrack(page);

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();

  await expect(page.locator('[data-editor-state="empty-selection"]')).toHaveCSS("opacity", "1");
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();
});

test("toggles advanced metadata from the entire setting row exactly once", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "settings" }).click();

  const advancedSetting = page.getByRole("checkbox", { name: "enable advanced metadata" });
  const advancedSettingRow = page.locator("label").filter({ hasText: "enable advanced metadata" });
  const bounds = await advancedSettingRow.boundingBox();
  if (!bounds) throw new Error("advanced metadata setting row bounds were not found");

  await advancedSettingRow.click({
    position: { x: bounds.width - 4, y: bounds.height - 4 },
  });
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

  const advancedSetting = page.getByRole("checkbox", { name: "enable advanced metadata" });
  await expect(advancedSetting).not.toBeChecked();
  await page.getByText("metadata linking", { exact: true }).click();
  await expect(page.getByText("link album artist to track artist")).not.toBeAttached();

  await advancedSetting.click();
  await expect(page.getByText("link album artist to track artist")).toBeVisible();
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
  await advancedSetting.click();
  await page.getByRole("button", { name: "back to workspace" }).click();
  await expect(page.getByRole("group", { name: "metadata fields" })).not.toBeAttached();

  await page.getByRole("button", { name: "settings" }).click();
  await advancedSetting.click();
  await page.getByRole("button", { name: "back to workspace" }).click();
  await expect(page.getByRole("button", { name: "advanced", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#track-composer")).toHaveValue("Retained composer");
});
