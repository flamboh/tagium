import type { Page } from "@playwright/test";
import {
  captureDownload,
  expectLosslessAudio,
  inspectAudio,
  unzipDownload,
} from "../support/audio";
import { expect, IMPORT_TIMEOUT, test } from "../support/test";
import {
  cobaltRequests,
  downloadTrackButton,
  importUrl,
  mp3BitrateKbps,
  notifications,
  streamFixture,
  useSettings,
  waitForTrackReady,
  savedAs,
} from "./helpers";

test.describe.configure({ timeout: 120_000 });

const openImportSettings = async (page: Page) => {
  await page.getByRole("button", { name: "settings" }).click();
  await expect(page.getByRole("heading", { name: "importing" })).toBeVisible();
};

const backToWorkspace = (page: Page) =>
  page.getByRole("button", { name: "back to workspace" }).click();

test("converts imports to mp3 at the bitrate chosen in settings", async ({
  browserName,
  page,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({
    title: "Low Bitrate",
    author: "Squeezer",
    cover: null,
  });

  await page.goto("/");
  await openImportSettings(page);
  await page.getByRole("button", { name: "mp3 bitrate, 320 kbps" }).click();
  await page
    .getByRole("group", { name: "mp3 bitrate" })
    .getByRole("button", { name: "128 kbps" })
    .click();
  await expect(page.getByRole("button", { name: "mp3 bitrate, 128 kbps" })).toBeVisible();
  await backToWorkspace(page);

  await importUrl(page, video.url);
  await waitForTrackReady(page);
  const exported = await captureDownload(page, () => downloadTrackButton(page).click());
  expect(exported.filename).toBe(savedAs(browserName, "Low Bitrate.mp3"));
  expect(mp3BitrateKbps(exported.bytes)).toBe(128);
  expect((await inspectAudio(exported)).metadata).toMatchObject({
    title: "Low Bitrate",
    artist: "Squeezer",
  });
  expect(await cobaltRequests(upstreams)).toEqual([
    expect.objectContaining({ url: video.url, audioFormat: "mp3", audioBitrate: "128" }),
  ]);
});

test("keeps the original provider audio when best compatible is chosen", async ({
  browserName,
  page,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({
    title: "Original Video",
    audio: "m4a",
    cover: null,
  });
  const track = await upstreams.soundcloud.track({
    title: "Original Track",
    audio: "opus",
    cover: null,
  });

  await page.goto("/");
  await openImportSettings(page);
  await page.getByRole("button", { name: "download format, mp3" }).click();
  const formats = page.getByRole("group", { name: "download format" });
  await expect(
    formats.getByText(
      "keeps the original audio without converting it, usually opus from youtube and mp3 from soundcloud.",
    ),
  ).toBeVisible();
  await formats.getByRole("button", { name: /^best compatible/u }).click();
  await expect(
    page.getByRole("button", { name: "download format, best compatible" }),
  ).toBeVisible();
  await backToWorkspace(page);

  await importUrl(page, video.url);
  await waitForTrackReady(page);
  const youtubeFile = await captureDownload(page, () => downloadTrackButton(page).click());
  expect(youtubeFile.filename).toBe(savedAs(browserName, "Original Video.m4a"));
  expect((await inspectAudio(youtubeFile)).metadata.title).toBe("Original Video");
  await expectLosslessAudio(youtubeFile, streamFixture("m4a"));

  await importUrl(page, track.url);
  await expect(page.getByRole("heading", { level: 2 })).toContainText("Original Track");
  await waitForTrackReady(page);
  const soundcloudFile = await captureDownload(page, () => downloadTrackButton(page).click());
  expect(soundcloudFile.filename).toBe(savedAs(browserName, "Original Track.opus"));
  expect((await inspectAudio(soundcloudFile)).metadata.title).toBe("Original Track");
  await expectLosslessAudio(soundcloudFile, streamFixture("opus"));

  expect((await cobaltRequests(upstreams)).map((request) => request.audioFormat)).toEqual([
    "best",
    "best",
  ]);
});

test("downloads a single right after import when the setting is on", async ({
  browserName,
  page,
  context,
  upstreams,
}) => {
  await useSettings(context, { downloadAfterImport: true });
  const video = await upstreams.youtube.video({
    title: "Instant Song",
    author: "Hurry",
    cover: null,
  });

  await page.goto("/");
  await openImportSettings(page);
  await expect(
    page.getByRole("checkbox", { name: /start download immediately after import/u }),
  ).toBeChecked();
  await backToWorkspace(page);

  const exported = await captureDownload(page, () => importUrl(page, video.url));
  expect(exported.filename).toBe(savedAs(browserName, "Instant Song.mp3"));
  expect((await inspectAudio(exported)).metadata).toMatchObject({
    title: "Instant Song",
    artist: "Hurry",
  });
});

test("downloads an album right after import even when its cover cannot be imported", async ({
  page,
  context,
  upstreams,
}) => {
  await useSettings(context, { downloadAfterImport: true });
  const playlist = await upstreams.youtube.playlist({
    title: "Coverless",
    author: "Mixer",
    videos: [
      { title: "Coverless One", cover: null },
      { title: "Coverless Two", cover: null },
    ],
  });

  await page.goto("/");
  const archive = await captureDownload(page, async () => {
    await importUrl(page, playlist.url);
    await expect(notifications(page).getByText("cover art was not imported")).toBeVisible();
    await expect(
      notifications(page).getByText(
        "the tracks were imported without cover art. upload a jpeg or png manually.",
      ),
    ).toBeVisible();
  });
  await expect(page.getByText("downloaded 2/2", { exact: true })).toBeVisible(IMPORT_TIMEOUT);

  expect(archive.filename).toMatch(/\.zip$/u);
  const entries = unzipDownload(archive);
  expect(entries.map((entry) => entry.filename).sort()).toEqual([
    "Coverless/Coverless One.mp3",
    "Coverless/Coverless Two.mp3",
  ]);
  for (const [index, entry] of entries
    .toSorted((left, right) => left.filename.localeCompare(right.filename))
    .entries()) {
    const { metadata } = await inspectAudio(entry);
    expect(metadata).toMatchObject({ album: "Coverless", trackNumber: index + 1 });
    expect(metadata.picture).toHaveLength(0);
  }
});
