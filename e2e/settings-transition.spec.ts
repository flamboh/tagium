import { expect, test } from "@playwright/test";

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
