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
  await expect(page.getByRole("button", { name: "remove track" })).toBeAttached();
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

test("keeps the media entry within its return transition endpoints", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "geometry sampling is covered in Chromium");
  await page.goto("/");
  await page.getByRole("button", { name: "settings" }).click();
  await page.waitForTimeout(500);

  const transition = await page.evaluate(async () => {
    interface BrowserElement {
      click: () => void;
      closest: (selector: string) => BrowserElement | null;
      getBoundingClientRect: () => { left: number };
      parentElement: BrowserElement | null;
    }

    const browser = globalThis as unknown as {
      document: { querySelector: (selector: string) => BrowserElement | null };
      performance: { now: () => number };
      requestAnimationFrame: (callback: () => void) => number;
    };
    const input = browser.document.querySelector('input[name="media-url"]');
    const motion = input?.closest("form")?.parentElement;
    const back = browser.document.querySelector('button[aria-label="back to editor"]');
    if (!motion || !back) {
      throw new Error("media entry transition elements were not found");
    }

    const startLeft = motion.getBoundingClientRect().left;
    back.click();
    const samples: number[] = [];
    const startedAt = browser.performance.now();
    await new Promise<void>((resolve) => {
      const sample = () => {
        samples.push(motion.getBoundingClientRect().left);
        if (browser.performance.now() - startedAt >= 550) {
          resolve();
          return;
        }
        browser.requestAnimationFrame(sample);
      };
      browser.requestAnimationFrame(sample);
    });

    return {
      startLeft,
      endLeft: motion.getBoundingClientRect().left,
      samples,
    };
  });

  const minimumLeft = Math.min(transition.startLeft, transition.endLeft) - 2;
  const maximumLeft = Math.max(transition.startLeft, transition.endLeft) + 2;
  expect(transition.samples.every((left) => left >= minimumLeft && left <= maximumLeft)).toBe(true);
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

test("clicking blank space in the empty library closes settings", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "settings" }).click();
  await expect(page.getByRole("button", { name: "back to editor" })).toBeVisible();

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();

  await expect(page.getByRole("button", { name: "back to editor" })).not.toBeAttached();
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
  await expect(page.getByText("select a track to edit its tags", { exact: true })).toBeVisible();
});

test("switches between the empty selection and track editor in both directions", async ({
  page,
}) => {
  await uploadTrack(page);
  await page.getByRole("button", { name: "settings" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByText("select a track to edit its tags", { exact: true })).toBeVisible();
  await expect(page.locator('[data-editor-state="empty-selection"]')).toHaveCSS("opacity", "1");

  await getPopulatedTrackList(page).getByRole("button").first().click();
  await expect(page.getByRole("button", { name: "download track" })).toBeVisible();
  await expect(page.locator('[data-editor-state="loaded-track"]')).toHaveCSS("opacity", "1");

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();
  await expect(page.getByText("select a track to edit its tags", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();
});

test("releases the loaded editor immediately when reduced motion is preferred", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await uploadTrack(page);

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();

  await expect(page.locator('[data-editor-state="empty-selection"]')).toHaveCSS("opacity", "1");
  await expect(page.getByRole("button", { name: "download track" })).not.toBeAttached();
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
  await page.getByRole("button", { name: "back to editor" }).click();

  await expect(page.getByRole("group", { name: "metadata fields" })).toBeVisible();
  await page.getByRole("button", { name: "advanced" }).click();
  await page.locator("#track-composer").fill("Retained composer");
  await page.locator("#track-disc-number").fill("0");
  await page.getByRole("button", { name: "normal" }).click();
  await page.getByRole("button", { name: "download track" }).click();

  await expect(page.getByRole("button", { name: "advanced" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator("#track-disc-number")).toBeFocused();
  await expect(page.locator("#track-disc-number-error")).toBeVisible();
  await expect(page.locator("#track-composer")).toHaveValue("Retained composer");

  await page.getByRole("button", { name: "settings" }).click();
  await advancedSetting.click();
  await page.getByRole("button", { name: "back to editor" }).click();
  await expect(page.getByRole("group", { name: "metadata fields" })).not.toBeAttached();

  await page.getByRole("button", { name: "settings" }).click();
  await advancedSetting.click();
  await page.getByRole("button", { name: "back to editor" }).click();
  await expect(page.getByRole("button", { name: "normal" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "advanced" }).click();
  await expect(page.locator("#track-composer")).toHaveValue("Retained composer");
});
