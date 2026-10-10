import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import { FEATURE_DISCOVERY_STORAGE_KEY } from "../../src/features/discovery/featureDiscovery";
import { captureDownload, inspectAudio } from "../e2e/support/audio";

const sources = [
  {
    name: "youtube",
    url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    title: "Me at the zoo",
    artist: "jawed",
    duration: "0:19",
    seconds: 19,
  },
  {
    name: "soundcloud",
    url: "https://soundcloud.com/forss/introitus",
    title: "Introitus",
    artist: "Forss",
    duration: "1:38",
    seconds: 98,
  },
] as const;

const decodedDurationSeconds = (page: Page, bytes: Uint8Array) =>
  page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const context = new AudioContext();

    try {
      return (await context.decodeAudioData(data.buffer)).duration;
    } finally {
      await context.close();
    }
  }, Buffer.from(bytes).toString("base64"));

test.beforeEach(async ({ context }) => {
  await context.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ "share-links": true }));
  }, FEATURE_DISCOVERY_STORAGE_KEY);
});

for (const source of sources) {
  test(`imports a real ${source.name} track and exports a decodable file`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox", { name: "media url" }).fill(source.url);
    await page.getByRole("button", { name: "start media import" }).click();

    await expect(page.getByLabel("title", { exact: true })).toHaveValue(source.title);
    await expect(page.getByLabel("artist", { exact: true })).toHaveValue(source.artist);
    const download = page.getByRole("button", { name: "download track" });
    await expect(download).toBeEnabled();
    await expect(page.getByText(new RegExp(`\\b${source.duration}\\b`, "u")).first()).toBeVisible();

    const exported = await captureDownload(page, () => download.click());
    const { format, metadata } = await inspectAudio(exported);
    expect(format).toBe("mp3");
    expect(metadata.title).toBe(source.title);
    expect(
      Math.abs((await decodedDurationSeconds(page, exported.bytes)) - source.seconds),
    ).toBeLessThan(1);
  });
}
