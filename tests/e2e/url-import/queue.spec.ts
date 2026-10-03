import { imageFixtures } from "../fixtures/catalog.ts";
import { captureDownload, inspectAudio, unzipDownload } from "../support/audio";
import { IMPORT_TIMEOUT, test } from "../support/test";
import type { Upstreams } from "../support/upstreams";
import {
  audioPreview,
  cobaltRequestCount,
  cobaltRequests,
  downloadTrackButton,
  field,
  holdDownloadPlans,
  imageSize,
  importUrl,
  numberField,
  queueStatus,
  removeTrack,
  useSettings,
  expect,
} from "./helpers";

test.describe.configure({ timeout: 120_000 });

const trackButtons = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^\d+ .+\.(mp3|opus)$/u });

const fiveTrackSet = (upstreams: Upstreams, title: string) =>
  upstreams.soundcloud.set({
    title,
    author: "Queue Artist",
    isAlbum: true,
    artwork: null,
    tracks: Array.from({ length: 5 }, (_, index) => ({
      title: `Track ${index + 1}`,
      cover: null,
    })),
  });

test("imports a youtube playlist as an ordered album, three downloads at a time", async ({
  page,
  upstreams,
}) => {
  const playlist = await upstreams.youtube.playlist({
    title: "Status Update Music",
    author: "lucida",
    pageSize: 2,
    videos: [
      { title: "First Video", year: 2026, durationSec: 254 },
      { title: "Second Video" },
      { title: "Third Video" },
      { title: "Fourth Video" },
    ],
  });
  const plans = await holdDownloadPlans(page);

  await page.goto("/");
  await importUrl(page, playlist.url);

  await expect(
    page.getByRole("button", { name: "Status Update Music lucida · 4 tracks" }),
  ).toBeVisible();
  await expect(queueStatus(page, "downloading 0/4")).toBeVisible();
  await expect(trackButtons(page)).toHaveText([
    /^1\s*First Video\.mp3$/u,
    /^2\s*Second Video\.mp3$/u,
    /^3\s*Third Video\.mp3$/u,
    /^4\s*Fourth Video\.mp3$/u,
  ]);
  await expect(field(page, "title")).toHaveValue("First Video");
  await expect(field(page, "album")).toHaveValue("Status Update Music");
  await expect(field(page, "artist")).toHaveValue("lucida");
  await expect(numberField(page, "year")).toHaveValue("2026");
  await expect(numberField(page, "track")).toHaveValue("1");
  await expect(audioPreview(page)).toContainText("0:00 / 4:14");

  await expect.poll(plans.requested).toEqual(playlist.videos.slice(0, 3).map((video) => video.url));
  await expect(page.getByText("+1 more", { exact: true })).toBeVisible();
  expect(plans.requested()).toHaveLength(3);

  await plans.releaseAll();
  await expect(queueStatus(page, "downloaded 4/4")).toBeVisible(IMPORT_TIMEOUT);
  expect(plans.requested()).toEqual(playlist.videos.map((video) => video.url));
  expect(plans.years()).toEqual([2026, 2026, 2026, 2026]);

  await page.getByRole("button", { name: "download all" }).click();
  const archive = await captureDownload(page, () =>
    page
      .getByRole("dialog", { name: "download 4 tracks" })
      .getByRole("button", { name: /^download ~/u })
      .click(),
  );
  const entries = unzipDownload(archive);
  const cover = entries.find((file) => file.filename === "albums/Status Update Music/cover.jpg");
  expect(imageSize(cover!.bytes)).toEqual({
    width: imageFixtures.thumbnail.width,
    height: imageFixtures.thumbnail.height,
  });
  expect(await upstreams.calls({ route: "ytimg.thumbnail" })).not.toHaveLength(0);
  for (const [index, video] of playlist.videos.entries()) {
    const entry = entries.find(
      (file) => file.filename === `albums/Status Update Music/${video.title}.mp3`,
    );
    const { metadata } = await inspectAudio(entry!);
    expect(metadata).toMatchObject({
      title: video.title,
      album: "Status Update Music",
      artist: "lucida",
      year: 2026,
      trackNumber: index + 1,
    });
    expect(imageSize(metadata.picture[0]!.data)).toEqual({
      width: imageFixtures.thumbnail.width,
      height: imageFixtures.thumbnail.height,
    });
  }
  expect(await upstreams.calls({ route: "youtube.browse" })).toHaveLength(1);
});

test("removing a downloading and a queued track shrinks the run and starts the next track", async ({
  page,
  context,
  upstreams,
}) => {
  await useSettings(context, { audioFormat: "best" });
  const set = await fiveTrackSet(upstreams, "Removal Set");
  const [first, second, third, fourth, fifth] = set.tracks;
  const plans = await holdDownloadPlans(page);

  await page.goto("/");
  await importUrl(page, set.url);
  await expect(queueStatus(page, "downloading 0/5")).toBeVisible();
  await expect.poll(plans.requested).toEqual([first!.url, second!.url, third!.url]);

  await removeTrack(page, "Track 1.mp3");
  await expect(queueStatus(page, "downloading 0/4")).toBeVisible();
  await expect.poll(plans.requested).toEqual([first!.url, second!.url, third!.url, fourth!.url]);

  await removeTrack(page, "Track 5.mp3");
  await expect(queueStatus(page, "downloading 0/3")).toBeVisible();

  await plans.releaseAll();
  await expect(queueStatus(page, "downloaded 3/3")).toBeVisible(IMPORT_TIMEOUT);
  await expect(trackButtons(page)).toHaveText([
    /^1\s*Track 2\.opus$/u,
    /^2\s*Track 3\.opus$/u,
    /^3\s*Track 4\.opus$/u,
  ]);
  await expect(page.getByRole("button", { name: "download all" })).toBeEnabled();
  expect(plans.requested()).not.toContain(fifth!.url);
  expect((await cobaltRequests(upstreams)).map((request) => request.url).sort()).toEqual(
    [second!.url, third!.url, fourth!.url].sort(),
  );
});

test("canceling a playlist keeps its tracks and retry downloads all of them", async ({
  page,
  context,
  upstreams,
}) => {
  await useSettings(context, { audioFormat: "best" });
  const set = await fiveTrackSet(upstreams, "Cancel Set");
  const plans = await holdDownloadPlans(page);

  await page.goto("/");
  await importUrl(page, set.url);
  await expect.poll(() => plans.requested().length).toBe(3);

  await page.getByRole("button", { name: "cancel playlist downloads" }).click();
  await expect(queueStatus(page, "canceled 5/5")).toBeVisible();
  await expect(page.getByText("remaining tracks canceled", { exact: true })).toBeVisible();
  await expect(audioPreview(page).getByRole("status")).toHaveText("download canceled");
  await expect(downloadTrackButton(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "download all" })).toBeDisabled();
  await expect(trackButtons(page)).toHaveCount(5);
  await plans.releaseAll();

  await page.getByRole("button", { name: "retry playlist downloads" }).click();
  await expect(queueStatus(page, "downloaded 5/5")).toBeVisible(IMPORT_TIMEOUT);
  await expect(page.getByRole("button", { name: "download all" })).toBeEnabled();
  expect(plans.requested().slice(3).sort()).toEqual(set.tracks.map((track) => track.url).sort());
  for (const track of set.tracks) {
    expect(await cobaltRequestCount(upstreams, track.url)).toBe(1);
  }
});

test("a failed playlist track keeps the successes and retry downloads only the failure", async ({
  page,
  context,
  upstreams,
}) => {
  await useSettings(context, { audioFormat: "best" });
  const set = await upstreams.soundcloud.set({
    title: "Partial Set",
    author: "Queue Artist",
    isAlbum: true,
    artwork: null,
    tracks: [
      { title: "Track 1", cover: null },
      {
        title: "Track 2",
        cover: null,
        cobalt: [{ kind: "error", code: "error.api.content.video.unavailable" }, { kind: "ok" }],
      },
      { title: "Track 3", cover: null },
      { title: "Track 4", cover: null },
    ],
  });

  await page.goto("/");
  await importUrl(page, set.url);
  await expect(queueStatus(page, "failed 1/4")).toBeVisible(IMPORT_TIMEOUT);
  await expect(page.getByText("downloads failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "download all" })).toBeDisabled();

  await page.getByRole("button", { name: "2 Track 2.mp3 track has an error" }).click();
  await expect(page.getByText("media is private, unavailable, or no longer exists.")).toBeVisible();
  await page.getByRole("button", { name: "3 Track 3.opus" }).click();
  const survivor = await captureDownload(page, () => downloadTrackButton(page).click());
  expect((await inspectAudio(survivor)).metadata).toMatchObject({
    title: "Track 3",
    album: "Partial Set",
    trackNumber: 3,
  });

  await page.getByRole("button", { name: "retry playlist downloads" }).click();
  await expect(page.getByRole("button", { name: "download all" })).toBeEnabled(IMPORT_TIMEOUT);
  await expect(page.getByRole("button", { name: /track has an error/u })).toHaveCount(0);
  await expect(queueStatus(page, "failed 1/4")).toBeHidden();
  const [one, two, three, four] = set.tracks;
  expect(await cobaltRequestCount(upstreams, two!.url)).toBe(2);
  for (const track of [one!, three!, four!]) {
    expect(await cobaltRequestCount(upstreams, track.url)).toBe(1);
  }
});
