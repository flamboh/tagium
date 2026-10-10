import type { Page } from "@playwright/test";
import { test } from "../support/test";
import { audioPreview, expect, importUrl, waitForTrackReady } from "./helpers";

type Frame = { status: string; heights: number[] };

const holdTunnel = async (page: Page) => {
  let release = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route("**/api/cobalt/tunnel?**", async (route) => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });

  return release;
};

declare global {
  interface Window {
    e2eReleaseDecoding?: () => void;
    e2eWaveformFrames?: { status: string; d: string }[];
  }
}

const holdDecoding = (page: Page) =>
  page.addInitScript(() => {
    const gate = new Promise<void>((resolve) => {
      window.e2eReleaseDecoding = resolve;
    });

    window.OfflineAudioContext = class extends window.OfflineAudioContext {
      override async decodeAudioData(data: ArrayBuffer) {
        await gate;

        return super.decodeAudioData(data);
      }
    };
  });

const releaseDecoding = (page: Page) => page.evaluate(() => window.e2eReleaseDecoding?.());

const recordFrames = (page: Page) =>
  page.addInitScript(() => {
    const frames: { status: string; d: string }[] = [];
    window.e2eWaveformFrames = frames;
    new MutationObserver(() => {
      const section = document.querySelector<HTMLElement>("[data-track-waveform]");

      const d = section
        ?.querySelector('[aria-label="playback position"] svg path')
        ?.getAttribute("d");

      if (section && d && d !== frames.at(-1)?.d) {
        frames.push({ status: section.dataset.waveformStatus!, d });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["d"] });
  });

const takeFrames = (page: Page): Promise<Frame[]> =>
  page.evaluate(() =>
    window.e2eWaveformFrames!.splice(0).map(({ status, d }) => ({
      status,
      heights: [...d.matchAll(/v([\d.]+)/gu)].map((match) => Number(match[1])),
    })),
  );

const pathData = (page: Page) =>
  audioPreview(page)
    .getByRole("slider", { name: "playback position" })
    .locator("svg path")
    .first()
    .getAttribute("d");

const settledPathData = async (page: Page) => {
  let settled = "";
  await expect
    .poll(async () => {
      const before = await pathData(page);
      await page.waitForTimeout(400);
      const after = await pathData(page);
      settled = after ?? "";

      return before === after;
    })
    .toBe(true);

  return settled;
};

const distinctPaths = async (page: Page, samples: number) => {
  const seen = new Set<string | null>();

  for (let index = 0; index < samples; index += 1) {
    seen.add(await pathData(page));
    await page.waitForTimeout(150);
  }

  return seen.size;
};

const sameHeights = (a: number[], b: number[]) =>
  a.length === b.length && a.every((value, index) => Math.abs(value - b[index]!) < 0.01);

const meanHeight = (frame: Frame) =>
  frame.heights.reduce((total, height) => total + height, 0) / frame.heights.length;

const expectGroove = (frames: Frame[]) => {
  const means = frames.map(meanHeight);
  const heights = frames.flatMap((frame) => frame.heights);
  expect(Math.max(...means) - Math.min(...means)).toBeGreaterThan(4);
  expect(Math.max(...heights)).toBeLessThanOrEqual(0.9 * 21.5 + 0.01);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(1);
};

const expectTween = (frames: Frame[]) => {
  const handoff = frames.findIndex((frame) => frame.status === "ready");
  expect(handoff).toBeGreaterThan(0);
  const start = frames[handoff - 1]!;
  const end = frames.at(-1)!;
  expect(start.status).toBe("loading");
  expect(sameHeights(start.heights, end.heights)).toBe(false);
  const tween = frames.slice(handoff);

  for (const frame of tween) {
    expect(frame.heights).toHaveLength(end.heights.length);
    frame.heights.forEach((height, index) => {
      const [low, high] = [start.heights[index]!, end.heights[index]!].sort((x, y) => x - y);
      expect(height).toBeGreaterThanOrEqual(low! - 0.01);
      expect(height).toBeLessThanOrEqual(high! + 0.01);
    });
  }

  expect(tween.some((frame) => !sameHeights(frame.heights, end.heights))).toBe(true);
};

test("the waveform bounces to a beat while a track downloads and decodes, then tweens into its peaks", async ({
  page,
  upstreams,
}) => {
  const first = await upstreams.soundcloud.track({ title: "Loading Wave" });
  const second = await upstreams.soundcloud.track({ title: "Other Wave" });
  const releaseTunnel = await holdTunnel(page);
  await holdDecoding(page);
  await recordFrames(page);
  const preview = audioPreview(page);

  await page.goto("/");
  await importUrl(page, first.url);
  await expect(preview).toHaveAttribute("data-waveform-status", "waiting");
  await expect(preview).toHaveAttribute("data-waveform-loading", "true");
  await takeFrames(page);
  expect(await distinctPaths(page, 10)).toBeGreaterThan(3);
  expectGroove(await takeFrames(page));

  releaseTunnel();
  await expect(preview).toHaveAttribute("data-waveform-status", "loading");
  await expect(preview).toHaveAttribute("data-waveform-loading", "true");
  expect(await distinctPaths(page, 5)).toBeGreaterThan(3);

  await takeFrames(page);
  await releaseDecoding(page);
  await expect(preview).toHaveAttribute("data-waveform-status", "ready");
  await expect(preview).not.toHaveAttribute("data-waveform-loading");
  const final = await settledPathData(page);
  expectTween(await takeFrames(page));

  await waitForTrackReady(page);
  await importUrl(page, second.url);
  await expect(page.getByRole("button", { name: "Other Wave.mp3", exact: true })).toBeVisible();
  await waitForTrackReady(page);
  await settledPathData(page);
  await takeFrames(page);
  await page.getByRole("button", { name: "Loading Wave.mp3", exact: true }).click();
  await expect(preview).toHaveAttribute("data-waveform-status", "ready");
  await expect(preview).not.toHaveAttribute("data-waveform-loading");
  expect(await settledPathData(page)).toBe(final);
  const revisit = await takeFrames(page);
  expect(revisit.length).toBeGreaterThan(0);

  for (const frame of revisit) expect(frame.status).toBe("ready");
  const settled = revisit.at(-1)!;
  const sameWidth = revisit.filter((frame) => frame.heights.length === settled.heights.length);

  for (const frame of sameWidth) expect(frame.heights).toEqual(settled.heights);
});

test("the waveform stays still while loading when reduced motion is requested", async ({
  page,
  upstreams,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const track = await upstreams.soundcloud.track({ title: "Still Wave" });
  const releaseTunnel = await holdTunnel(page);
  await holdDecoding(page);
  await recordFrames(page);
  const preview = audioPreview(page);

  await page.goto("/");
  await importUrl(page, track.url);
  await expect(preview).toHaveAttribute("data-waveform-status", "waiting");
  expect(await distinctPaths(page, 5)).toBe(1);

  releaseTunnel();
  await expect(preview).toHaveAttribute("data-waveform-status", "loading");
  expect(await distinctPaths(page, 5)).toBe(1);

  await takeFrames(page);
  await releaseDecoding(page);
  await expect(preview).toHaveAttribute("data-waveform-status", "ready");
  const final = await settledPathData(page);
  const ready = (await takeFrames(page)).filter((frame) => frame.status === "ready");
  expect(ready.length).toBeGreaterThan(0);

  for (const frame of ready) expect(frame.heights).toEqual(ready.at(-1)!.heights);
  expect(await pathData(page)).toBe(final);
});
