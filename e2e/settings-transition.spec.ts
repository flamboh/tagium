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

test("keeps the media entry within its return transition endpoints", async ({ page }) => {
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

test("crossfades the metadata editor and settings without unmounting either panel", async ({
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
  await page.waitForTimeout(100);

  const midpoint = await Promise.all([
    editor.evaluate((element) =>
      Number.parseFloat(
        element.ownerDocument.defaultView?.getComputedStyle(element).opacity ?? "0",
      ),
    ),
    settings.evaluate((element) =>
      Number.parseFloat(
        element.ownerDocument.defaultView?.getComputedStyle(element).opacity ?? "0",
      ),
    ),
  ]);
  expect(midpoint[0]).toBeGreaterThan(0);
  expect(midpoint[0]).toBeLessThan(1);
  expect(midpoint[1]).toBeGreaterThan(0);
  expect(midpoint[1]).toBeLessThan(1);

  await expect(editor).toHaveCSS("opacity", "0");
  await expect(settings).toHaveCSS("opacity", "1");
});
