import { expect, test, type Locator, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { materializeFixture } from "./support/audioFixtures";

const sampleText = "abcdefghijklmnopqrstuvwx";

const enableAdvancedMetadata = async (page: Page) => {
  await page.getByRole("button", { name: "settings" }).click();
  await page.getByRole("button", { name: "editing", exact: true }).click();
  await page.getByRole("checkbox", { name: "show advanced fields" }).click();
  await page.getByRole("button", { name: "back to workspace" }).click();
};

const uploadAlbum = async (page: Page) => {
  const fixture = await materializeFixture("mp3");
  await page.locator('input[type="file"][multiple]').setInputFiles(
    Array.from({ length: 40 }, (_, index) => ({
      name: `performance-track-${index + 1}.mp3`,
      mimeType: "audio/mpeg",
      buffer: Buffer.from(fixture),
    })),
  );
  await expect(page.locator("#track-title")).toBeVisible();
};

const typeMeasuredText = async (page: Page, input: Locator) => {
  await input.fill("");
  await input.focus();
  const inputId = await input.getAttribute("id");
  await page.evaluate((id) => {
    const entries = Reflect.get(window, "__tagiumInputProcessing") as {
      id: string;
      processingMs: number;
    }[];
    for (let index = entries.length - 1; index >= 0; index--) {
      if (entries[index]?.id === id) entries.splice(index, 1);
    }
  }, inputId);
  for (const character of sampleText) {
    await page.keyboard.type(character);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }
  await page.waitForTimeout(100);
};

const readP95ProcessingTime = async (page: Page, targetId: string) =>
  page.evaluate(
    ({ id, sampleCount }) => {
      const entries = Reflect.get(window, "__tagiumInputProcessing") as
        | { id: string; processingMs: number }[]
        | undefined;
      if (!entries) throw new Error("input processing measurement was not installed");

      const samples = entries.filter((entry) => entry.id === id).map((entry) => entry.processingMs);
      if (samples.length !== sampleCount) {
        throw new Error(`expected ${sampleCount} ${id} samples, received ${samples.length}`);
      }
      samples.sort((left, right) => left - right);
      return samples[Math.ceil(samples.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    },
    { id: targetId, sampleCount: sampleText.length },
  );

test("keeps track title editing responsive in a large album", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Event Timing is covered in Chromium");
  await page.goto("/");
  await enableAdvancedMetadata(page);
  await uploadAlbum(page);
  await page.evaluate(() => {
    const startedAt = new WeakMap<Event, number>();
    const entries: { id: string; processingMs: number }[] = [];
    Reflect.set(window, "__tagiumInputProcessing", entries);
    document.addEventListener(
      "input",
      (event) => {
        startedAt.set(event, performance.now());
      },
      true,
    );
    document.addEventListener("input", (event) => {
      const start = startedAt.get(event);
      if (start === undefined) return;
      entries.push({
        id: event.target instanceof HTMLElement ? event.target.id : "",
        processingMs: performance.now() - start,
      });
    });
  });

  await typeMeasuredText(page, page.locator("#track-title"));
  await page.getByRole("button", { name: "advanced" }).click();
  await typeMeasuredText(page, page.locator("#track-comment"));

  const titleP95 = await readP95ProcessingTime(page, "track-title");
  const commentP95 = await readP95ProcessingTime(page, "track-comment");
  expect(
    titleP95,
    `title p95 ${titleP95.toFixed(1)} ms; comment p95 ${commentP95.toFixed(1)} ms`,
  ).toBeLessThanOrEqual(commentP95 + 8);
  await expect(
    page.getByRole("button", { name: new RegExp(`${sampleText}\\.mp3`, "u") }).first(),
  ).toBeVisible();
});
