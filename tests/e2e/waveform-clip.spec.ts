import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { unzipSync } from "fflate";
import { makeBlobByteSource } from "../../src/features/audio/metadataEngine/byteSource";
import { flacDriver } from "../../src/features/audio/metadataEngine/flac";
import { mp4Driver } from "../../src/features/audio/metadataEngine/mp4";
import { opusDriver } from "../../src/features/audio/metadataEngine/opus";
import { mp3Driver } from "../../src/features/audio/metadataEngine/mp3/mp3Driver";

const drivers = { mp3: mp3Driver, flac: flacDriver, m4a: mp4Driver, opus: opusDriver };
const cases = [
  { family: "mp3", width: 1280 },
  { family: "mp3", width: 390 },
  { family: "flac", width: 1280 },
  { family: "m4a", width: 1280 },
  { family: "opus", width: 1280 },
] as const;

for (const { family, width } of cases) {
  const fixture = fileURLToPath(new URL(`./fixtures/waveform.${family}`, import.meta.url));
  test(`previews, clips, and resets an exported ${family} track at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.locator('input[type="file"]').first().setInputFiles(fixture);
    const preview = page.getByRole("region", { name: "audio preview" });
    await expect(preview).toHaveAttribute("data-waveform-status", "ready");
    await page.getByLabel("title", { exact: true }).fill("clipped title");

    await preview.getByRole("button", { name: "play", exact: true }).click();
    await expect(preview.getByRole("button", { name: "pause", exact: true })).toBeVisible();
    if (width < 768) await page.getByRole("button", { name: "open library" }).click();
    await page.getByRole("button", { name: "settings", exact: true }).click();
    await expect(page.locator("[data-track-waveform] audio")).toHaveJSProperty("paused", true);
    if (width < 768) await page.goBack();
    else await page.getByRole("button", { name: "back to workspace" }).click();

    const start = preview.getByRole("slider", { name: "clip start" });
    const end = preview.getByRole("slider", { name: "clip end" });
    await start.focus();
    await start.press("ArrowRight");
    await start.press("ArrowRight");
    await expect(start).toHaveAttribute("aria-valuenow", "2");
    await end.focus();
    await end.press("ArrowLeft");
    await end.press("ArrowLeft");
    await expect(end).toHaveAttribute("aria-valuenow", "4");
    await expect
      .poll(() => preview.evaluate((element) => element.getBoundingClientRect().right))
      .toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath("clipped.png") });

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "download track", exact: true }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).not.toBeNull();
    const clippedBytes = await readFile(path!);
    const clipped = await Effect.runPromise(
      drivers[family].inspect(makeBlobByteSource(new Blob([clippedBytes]))),
    );
    expect(clipped.metadata.title).toBe("clipped title");
    expect(clipped.metadata.artist).toBe("test artist");
    expect(clipped.metadata.duration).toBeGreaterThan(1.8);
    expect(clipped.metadata.duration).toBeLessThan(2.3);

    if (family === "mp3" && width === 1280) {
      await page.getByRole("button", { name: "download all", exact: true }).click();
      const bulkDownloadPromise = page.waitForEvent("download");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^download ~/ })
        .click();
      const bulkDownload = await bulkDownloadPromise;
      const bulkPath = await bulkDownload.path();
      expect(bulkPath).not.toBeNull();
      const zip = unzipSync(new Uint8Array(await readFile(bulkPath!)));
      const audio = Object.values(zip).find((bytes) => bytes.length > 0);
      expect(audio).toBeDefined();
      const bulk = await Effect.runPromise(
        mp3Driver.inspect(makeBlobByteSource(new Blob([Uint8Array.from(audio!)]))),
      );
      expect(bulk.metadata.duration).toBeGreaterThan(1.8);
      expect(bulk.metadata.duration).toBeLessThan(2.3);
      expect(bulk.metadata.title).toBe("clipped title");
    }

    await preview.getByRole("button", { name: "reset clip", exact: true }).click();
    await expect(start).toHaveAttribute("aria-valuenow", "0");
    const resetDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "download track", exact: true }).click();
    const resetDownload = await resetDownloadPromise;
    const resetPath = await resetDownload.path();
    expect(resetPath).not.toBeNull();
    const reset = await Effect.runPromise(
      drivers[family].inspect(makeBlobByteSource(new Blob([await readFile(resetPath!)]))),
    );
    expect(reset.metadata.duration).toBeGreaterThan(5.9);
    expect(reset.metadata.title).toBe("clipped title");
  });
}
