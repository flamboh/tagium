import { expect, test, type Locator, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { materializeFixture } from "./support/audioFixtures";

const textBursts = ["abcdef", "ghijkl", "mnopqr", "stuvwx"] as const;
const sampleText = textBursts.join("");

interface FrameProbe {
  active: boolean;
  gaps: number[];
  previous: number;
}

declare global {
  interface Window {
    __tagiumFrameProbe?: FrameProbe;
  }
}

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
  await expect(page.getByText("library (40)", { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
};

const percentile = (values: readonly number[], fraction: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? Number.POSITIVE_INFINITY;
};

const measureBurstMax = async (page: Page, input: Locator, text: string) => {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const probe: FrameProbe = { active: true, gaps: [], previous: 0 };
        window.__tagiumFrameProbe = probe;
        const sample = (now: number) => {
          if (!probe.active) return;
          probe.gaps.push(now - probe.previous);
          probe.previous = now;
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(() =>
          requestAnimationFrame((now) => {
            probe.previous = now;
            requestAnimationFrame(sample);
            resolve();
          }),
        );
      }),
  );
  await input.pressSequentially(text, { delay: 30 });
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const probe = window.__tagiumFrameProbe;
    if (!probe) throw new Error("frame probe was not installed");
    probe.active = false;
    return Math.max(...probe.gaps);
  });
};

const measureTyping = async (page: Page, input: Locator) => {
  const maxima: number[] = [];
  await input.fill("warmup");
  await page.waitForTimeout(250);

  for (let repetition = 0; repetition < 3; repetition++) {
    await input.fill("");
    await page.waitForTimeout(250);
    await input.focus();
    for (const burst of textBursts) {
      maxima.push(await measureBurstMax(page, input, burst));
    }
  }

  return { maxima, p75Max: percentile(maxima, 0.75) };
};

test("keeps track title editing as responsive as album title editing", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "frame timing is covered in Chromium");
  await page.goto("/");
  await uploadAlbum(page);

  await page
    .getByRole("button", { name: /^album actions for /u })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "edit album" }).click();
  const albumTitle = page.locator("#album-title");
  await expect(albumTitle).toBeVisible();
  await page.waitForTimeout(400);
  const album = await measureTyping(page, albumTitle);
  await page.getByRole("button", { name: "cancel" }).click();
  await expect(albumTitle).toBeHidden();
  await page.waitForTimeout(400);

  const track = await measureTyping(page, page.locator("#track-title"));
  expect(
    track.p75Max,
    `track burst maxima ${track.maxima.map((value) => value.toFixed(1)).join(", ")} ms; album burst maxima ${album.maxima.map((value) => value.toFixed(1)).join(", ")} ms`,
  ).toBeLessThanOrEqual(album.p75Max + 16);
  await expect(
    page.getByRole("button", { name: new RegExp(`${sampleText}\\.mp3`, "u") }).first(),
  ).toBeVisible();
});
