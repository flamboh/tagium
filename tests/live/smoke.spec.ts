import { Buffer } from "node:buffer";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { FEATURE_DISCOVERY_STORAGE_KEY } from "../../src/features/discovery/featureDiscovery";
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
} from "../../src/features/settings/settings";
import type { AppSettings } from "../../src/features/library/types";
import { captureDownload, inspectAudio, unzipDownload } from "../e2e/support/audio";

const sources = [
  {
    name: "youtube",
    url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    title: "Me at the zoo",
    artist: "jawed",
    duration: "0:19",
    seconds: 19,
    audioFormat: "mp3",
    format: "mp3",
    cover: false,
  },
  ...(["mp3", "best"] as const).map((audioFormat) => ({
    name: `soundcloud ${audioFormat}`,
    url: "https://soundcloud.com/forss/introitus",
    title: "Introitus",
    artist: "Forss",
    duration: "1:38",
    seconds: 98,
    audioFormat,
    format: audioFormat === "best" ? "m4a" : "mp3",
    cover: true,
  })),
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

const topLevelBoxes = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: string[] = [];

  for (let offset = 0; offset + 8 <= bytes.byteLength;) {
    let size = view.getUint32(offset);
    boxes.push(Buffer.from(bytes.subarray(offset + 4, offset + 8)).toString("latin1"));

    if (size === 1) size = Number(view.getBigUint64(offset + 8));

    if (size === 0) break;
    offset += size;
  }

  return boxes;
};

const audioEndpoint = /^\/api\/(?:cobalt\/audio|soundcloud-stream)$/u;

const recordAudioFailures = (page: Page) => {
  const failures: Promise<string>[] = [];

  page.on("response", (response) => {
    const { pathname } = new URL(response.url());

    if (response.ok() || !audioEndpoint.test(pathname)) return;

    failures.push(
      response
        .text()
        .catch(() => "")
        .then((body) => `${response.status()} ${pathname} ${body}`.trim()),
    );
  });

  return failures;
};

const expectDownloadReady = async (page: Page, audioFailures: Promise<string>[]) => {
  const ready = page.getByRole("button", { name: "download track", disabled: false });
  const failed = page.getByText("download failed", { exact: true }).first();

  await expect(ready.or(failed).first()).toBeVisible();

  if (await failed.isVisible()) {
    const surfaced = await page
      .locator("[aria-live=polite]")
      .filter({ hasText: /\S/u })
      .allInnerTexts();

    const responses = await Promise.all(audioFailures);

    throw new Error(
      [
        "track download failed",
        `ui: ${surfaced.map((text) => text.replaceAll(/\s*\n\s*/gu, " / ")).join(" | ") || "none"}`,
        `api: ${responses.join(" | ") || "none"}`,
      ].join("\n"),
    );
  }
};

const useAudioFormat = (context: BrowserContext, audioFormat: AppSettings["audioFormat"]) =>
  context.addInitScript(
    ([key, settings]) => {
      localStorage.setItem(key, settings);
    },
    [APP_SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_APP_SETTINGS, audioFormat })] as const,
  );

test.beforeEach(async ({ context }) => {
  await context.addInitScript((key) => {
    localStorage.setItem(key, JSON.stringify({ "share-links": true }));
  }, FEATURE_DISCOVERY_STORAGE_KEY);
});

for (const source of sources) {
  test(`imports a real ${source.name} track and exports a decodable file`, async ({
    context,
    page,
  }) => {
    await useAudioFormat(context, source.audioFormat);
    const audioFailures = recordAudioFailures(page);
    await page.goto("/");
    await page.getByRole("textbox", { name: "media url" }).fill(source.url);
    await page.getByRole("button", { name: "start media import" }).click();

    await expect(page.getByLabel("title", { exact: true })).toHaveValue(source.title);
    await expect(page.getByLabel("artist", { exact: true })).toHaveValue(source.artist);
    await expectDownloadReady(page, audioFailures);
    const download = page.getByRole("button", { name: "download track" });
    await expect(page.getByText(new RegExp(`\\b${source.duration}\\b`, "u")).first()).toBeVisible();

    const exported = await captureDownload(page, () => download.click());
    const { format, metadata } = await inspectAudio(exported);
    expect(format).toBe(source.format);
    expect(metadata.title).toBe(source.title);
    expect(metadata.artist).toBe(source.artist);

    if (source.cover) expect(metadata.picture.length).toBeGreaterThan(0);

    if (source.format === "m4a") {
      expect(topLevelBoxes(exported.bytes)).toContain("moov");
      expect(topLevelBoxes(exported.bytes)).not.toContain("moof");
    }

    expect(
      Math.abs((await decodedDurationSeconds(page, exported.bytes)) - source.seconds),
    ).toBeLessThan(1);
  });
}

test("imports a real soundcloud album with tags and covers on every track", async ({
  context,
  page,
}) => {
  await useAudioFormat(context, "best");
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "media url" })
    .fill("https://soundcloud.com/forss/sets/ecclesia");
  await page.getByRole("button", { name: "start media import" }).click();

  await expect(page.getByText(/^downloaded (\d+)\/\1$/u)).toBeVisible({ timeout: 180_000 });
  await page.getByRole("button", { name: "download all" }).click();

  const archive = await captureDownload(page, () =>
    page
      .getByRole("dialog", { name: /^download \d+ tracks$/u })
      .getByRole("button", { name: /^download ~/u })
      .click(),
  );

  const tracks = unzipDownload(archive).filter((entry) => entry.filename.endsWith(".m4a"));
  expect(tracks.length).toBeGreaterThan(1);

  for (const track of tracks) {
    const { format, metadata } = await inspectAudio(track);
    expect(format).toBe("m4a");
    expect(metadata).toMatchObject({ album: "Ecclesia", artist: "Forss", year: 2012 });
    expect(metadata.picture.length).toBeGreaterThan(0);
    expect(topLevelBoxes(track.bytes)).not.toContain("moof");
  }
});
