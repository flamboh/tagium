import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { captureDownload, inspectAudio } from "../support/audio";
import { test } from "../support/test";
import { audioPreview, downloadTrackButton, expect, importUrl, waitForTrackReady } from "./helpers";
import { formatTimestamp } from "../../../src/features/editor/waveform";

const sixSeconds = readFileSync(
  fileURLToPath(new URL("../fixtures/waveform.mp3", import.meta.url)),
);

const clipPoint = (seconds: number) => formatTimestamp(Math.round(seconds * 100) / 100);

const holdTunnel = async (page: Page) => {
  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/cobalt/tunnel?**", async (route) => {
    const response = await route.fetch();
    await gate;
    const headers = { ...response.headers() };
    delete headers["content-length"];
    await route.fulfill({ status: response.status(), headers, body: sixSeconds });
  });

  return release;
};

const dragTo = async (page: Page, handle: Locator, x: number) => {
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
};

const handleFractions = async (preview: Locator) => {
  const fraction = (name: string) =>
    preview
      .getByRole("slider", { name })
      .evaluate((handle: HTMLElement) => Number.parseFloat(handle.style.left) / 100);

  return { start: await fraction("clip start"), end: await fraction("clip end") };
};

const cropDuringDownload = async (page: Page) => {
  const preview = audioPreview(page);
  const start = preview.getByRole("slider", { name: "clip start" });
  const end = preview.getByRole("slider", { name: "clip end" });
  await expect(preview).toHaveAttribute("data-waveform-loading", "true");
  await expect(start).toBeVisible();
  await expect(end).toBeVisible();
  await expect(preview.getByRole("button", { name: "play", exact: true })).toBeDisabled();
  await expect(downloadTrackButton(page)).toBeDisabled();

  const surface = (await preview.getByRole("slider", { name: "playback position" }).boundingBox())!;
  await dragTo(page, start, surface.x + surface.width * 0.25);
  await dragTo(page, end, surface.x + surface.width * 0.75);
  await expect(preview).toHaveAttribute("data-waveform-loading", "true");
  const fractions = await handleFractions(preview);
  expect(fractions.start).toBeCloseTo(0.25, 1);
  expect(fractions.end).toBeCloseTo(0.75, 1);

  return fractions;
};

const expectClipAfterLoad = async (page: Page, fractions: { start: number; end: number }) => {
  const preview = audioPreview(page);
  await expect(preview).toHaveAttribute("data-waveform-status", "ready");
  await waitForTrackReady(page);
  await expect(preview.getByRole("button", { name: "play", exact: true })).toBeEnabled();
  expect(await handleFractions(preview)).toEqual(fractions);

  const duration = await preview
    .locator("audio")
    .evaluate((audio: HTMLAudioElement) => audio.duration);

  expect(duration).toBeGreaterThan(5.9);
  const [from, to] = [fractions.start * duration, fractions.end * duration];
  const start = preview.getByRole("slider", { name: "clip start" });
  const end = preview.getByRole("slider", { name: "clip end" });
  await expect(start).toHaveAttribute("aria-valuenow", String(Math.round(from)));
  await expect(end).toHaveAttribute("aria-valuenow", String(Math.round(to)));
  await expect(preview).toContainText(`clip ${clipPoint(from)}–${clipPoint(to)}`);
  await expect(preview).toContainText(`${formatTimestamp(from)} / 0:06`);

  const clipped = await captureDownload(page, () => downloadTrackButton(page).click());
  const { metadata } = await inspectAudio(clipped);
  expect(Math.abs(metadata.duration - (to - from))).toBeLessThan(0.15);
};

test("crops a single track while it downloads and applies the crop to the loaded audio", async ({
  page,
  upstreams,
}) => {
  const track = await upstreams.soundcloud.track({ title: "Early Crop", audio: "mp3" });
  const release = await holdTunnel(page);
  const preview = audioPreview(page);

  await page.goto("/");
  await importUrl(page, track.url);
  await expect(preview).toHaveAttribute("data-waveform-status", "waiting");
  await expect(preview).toContainText("0:00 / −:−−");
  const fractions = await cropDuringDownload(page);
  await expect(preview).toContainText(
    `clip ${Math.round(fractions.start * 100)}%–${Math.round(fractions.end * 100)}%`,
  );

  release();
  await expectClipAfterLoad(page, fractions);
});

test("maps a crop made against a set track's listed length onto its real length", async ({
  page,
  upstreams,
}) => {
  const set = await upstreams.soundcloud.set({
    title: "Early Set",
    tracks: [{ title: "Listed Long", durationSec: 12, audio: "mp3" }],
  });

  const release = await holdTunnel(page);
  const preview = audioPreview(page);

  await page.goto("/");
  await importUrl(page, set.url);
  await expect(preview).toContainText("0:00 / 0:12");
  const fractions = await cropDuringDownload(page);
  await expect(preview).toContainText(
    `clip ${clipPoint(fractions.start * 12)}–${clipPoint(fractions.end * 12)}`,
  );

  release();
  await expectClipAfterLoad(page, fractions);
});
