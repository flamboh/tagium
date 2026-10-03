import { inspectAudio, unzipDownload } from "../support/audio";
import { expect, test } from "../support/test";
import {
  downloadAll,
  downloadTrack,
  field,
  pickFiles,
  waveformFixture,
  expectDownloadName,
} from "./workspace";

const cases = [
  { format: "mp3", width: 1280 },
  { format: "mp3", width: 390 },
  { format: "flac", width: 1280 },
  { format: "m4a", width: 1280 },
  { format: "opus", width: 1280 },
] as const;

for (const { format, width } of cases) {
  test(`clips and resets a ${format} export at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await pickFiles(page, [waveformFixture(format).upload]);
    const preview = page.getByRole("region", { name: "audio preview" });
    await expect(preview).toHaveAttribute("data-waveform-status", "ready");
    await expect(preview).toContainText(/0:00 \/ 0:0[56]/u);
    await field(page, "title").fill("clipped title");

    const start = preview.getByRole("slider", { name: "clip start" });
    const end = preview.getByRole("slider", { name: "clip end" });
    await start.press("ArrowRight");
    await start.press("ArrowRight");
    await expect(start).toHaveAttribute("aria-valuenow", "2");
    await end.press("ArrowLeft");
    await end.press("ArrowLeft");
    await expect(end).toHaveAttribute("aria-valuenow", "4");
    await expect(preview).toContainText(/clip 0:02–0:0[34]/u);
    const box = await preview.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);

    const clipped = await downloadTrack(page);
    expectDownloadName(clipped, `clipped title.${format}`);
    const { format: clippedFormat, metadata } = await inspectAudio(clipped);
    expect(clippedFormat).toBe(format);
    expect(metadata).toMatchObject({ title: "clipped title", artist: "test artist" });
    expect(metadata.duration).toBeGreaterThan(1.8);
    expect(metadata.duration).toBeLessThan(2.3);

    if (format === "mp3" && width > 768) {
      const archive = await downloadAll(page, "download 1 track");
      const [entry] = unzipDownload(archive);
      expect(entry!.filename).toBe("singles/clipped title.mp3");
      const bulk = await inspectAudio(entry!);
      expect(bulk.metadata.title).toBe("clipped title");
      expect(bulk.metadata.duration).toBeGreaterThan(1.8);
      expect(bulk.metadata.duration).toBeLessThan(2.3);
    }

    await preview.getByRole("button", { name: "reset clip", exact: true }).click();
    await expect(start).toHaveAttribute("aria-valuenow", "0");
    await expect(end).toHaveAttribute("aria-valuenow", /^[56]$/u);
    await expect(preview.getByRole("slider", { name: "playback position" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    const full = await inspectAudio(await downloadTrack(page));
    expect(full.metadata.title).toBe("clipped title");
    expect(full.metadata.duration).toBeGreaterThan(5.9);
  });
}

for (const width of [1280, 390]) {
  test(`pauses the preview when settings open at ${width}px`, async ({ page, browserName }) => {
    test.skip(
      browserName === "firefox",
      "headless firefox has no audio output here: playback fails with NS_ERROR_DOM_MEDIA_MEDIASINK_ERR",
    );
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await pickFiles(page, [waveformFixture("opus").upload]);
    const preview = page.getByRole("region", { name: "audio preview" });
    await expect(preview).toHaveAttribute("data-waveform-status", "ready");

    await preview.getByRole("button", { name: "play", exact: true }).click();
    await expect(preview.getByRole("button", { name: "pause", exact: true })).toBeVisible();
    await expect
      .poll(() =>
        preview.getByRole("slider", { name: "playback position" }).getAttribute("aria-valuenow"),
      )
      .not.toBe("0");
    if (width < 768) await page.getByRole("button", { name: "open library" }).click();
    await page.getByRole("button", { name: "settings", exact: true }).click();
    await expect(page.locator("[data-track-waveform] audio")).toHaveJSProperty("paused", true);
    await page.getByRole("button", { name: "back to workspace" }).click();
    await expect(preview.getByRole("button", { name: "play", exact: true })).toBeEnabled();
    await expect(preview.getByRole("slider", { name: "clip start" })).toBeVisible();
  });
}
