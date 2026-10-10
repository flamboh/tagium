import { imageFixtures } from "../fixtures/catalog.ts";
import { captureDownload, inspectAudio, unzipDownload } from "../support/audio";
import { JOURNEY_TIMEOUT, test } from "../support/test";
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
  SETTLE_TIMEOUT,
} from "./helpers";

test.describe.configure({ timeout: JOURNEY_TIMEOUT });

const trackButtons = (page: import("@playwright/test").Page) =>
  page.getByRole("button", { name: /^\d+ .+\.(mp3|m4a|opus)$/u });

const trackSet = (upstreams: Upstreams, title: string, count: number) =>
  upstreams.soundcloud.set({
    title,
    author: "Queue Artist",
    isAlbum: true,
    artwork: null,
    tracks: Array.from({ length: count }, (_, index) => ({
      title: `Track ${index + 1}`,
      cover: null,
    })),
  });

test("imports a youtube playlist as an ordered album, three downloads at a time", async ({
  page,
  context,
  upstreams,
}) => {
  await useSettings(context, { audioFormat: "best" });
  const playlist = await upstreams.youtube.playlist({
    title: "Status Update Music",
    author: "lucida",
    pageSize: 2,
    videos: [
      { title: "First Video", author: "First Artist - Topic", year: 2026, durationSec: 254 },
      { title: "Second Video", author: "Second Artist", year: 2019 },
      { title: "Third Video", author: "Third Artist", year: 2021 },
      { title: "Fourth Video", author: "Fourth Artist" },
    ],
  });
  const plans = await holdDownloadPlans(page);

  await page.goto("/");
  await importUrl(page, playlist.url);

  await expect(
    page.getByRole("button", { name: "Status Update Music unknown · 4 tracks" }),
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
  await expect(field(page, "artist")).toHaveValue("First Artist");
  await expect(field(page, "artist")).toBeEditable();
  await expect(numberField(page, "year")).toBeEditable();
  await expect(numberField(page, "year")).toHaveValue("");
  await expect(numberField(page, "track")).toHaveValue("1");
  await expect(audioPreview(page)).toContainText("0:00 / 4:14");
  for (const [index, video] of playlist.videos.entries()) {
    await trackButtons(page).nth(index).click();
    await expect(field(page, "artist")).toHaveValue(video.author.replace(/ - Topic$/u, ""));
    await expect(numberField(page, "year")).toHaveValue("");
  }

  await expect.poll(plans.requested).toEqual(playlist.videos.slice(0, 3).map((video) => video.url));
  await expect(page.getByText("+1 more", { exact: true })).toBeVisible();
  expect(plans.requested()).toHaveLength(3);
  expect(await upstreams.calls({ route: "youtube.next" })).toHaveLength(1);
  expect(await upstreams.calls({ route: "cobalt.resolve" })).toHaveLength(0);

  await plans.releaseAll();
  await expect(queueStatus(page, "downloaded 4/4")).toBeVisible(SETTLE_TIMEOUT);
  expect(plans.requested()).toEqual(playlist.videos.map((video) => video.url));
  expect(plans.years()).toEqual([undefined, undefined, undefined, undefined]);

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
      (file) => file.filename === `albums/Status Update Music/${video.title}.m4a`,
    );
    const { metadata } = await inspectAudio(entry!);
    expect(metadata).toMatchObject({
      title: video.title,
      album: "Status Update Music",
      artist: video.author.replace(/ - Topic$/u, ""),
      albumArtist: video.author.replace(/ - Topic$/u, ""),
      year: video.year ?? 2026,
      trackNumber: index + 1,
    });
    expect(imageSize(metadata.picture[0]!.data)).toEqual(
      video.author.endsWith(" - Topic")
        ? { width: 720, height: 720 }
        : { width: imageFixtures.thumbnail.width, height: imageFixtures.thumbnail.height },
    );
  }
  expect(await upstreams.calls({ route: "youtube.browse" })).toHaveLength(1);
});

test("removing a downloading and a queued track shrinks the run and starts the next track", async ({
  page,
  context,
  upstreams,
}) => {
  await useSettings(context, { audioFormat: "best" });
  const set = await trackSet(upstreams, "Removal Set", 5);
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
  await expect(queueStatus(page, "downloaded 3/3")).toBeVisible(SETTLE_TIMEOUT);
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
  const set = await trackSet(upstreams, "Cancel Set", 4);
  const plans = await holdDownloadPlans(page);

  await page.goto("/");
  await importUrl(page, set.url);
  await expect.poll(() => plans.requested().length).toBe(3);

  await page.getByRole("button", { name: "cancel playlist downloads" }).click();
  await expect(queueStatus(page, "canceled 4/4")).toBeVisible();
  await expect(page.getByText("remaining tracks canceled", { exact: true })).toBeVisible();
  await expect(audioPreview(page).getByRole("status")).toHaveText("download canceled");
  await expect(downloadTrackButton(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "download all" })).toBeDisabled();
  await expect(trackButtons(page)).toHaveCount(4);
  await plans.releaseAll();

  await page.getByRole("button", { name: "retry playlist downloads" }).click();
  await expect(queueStatus(page, "downloaded 4/4")).toBeVisible(SETTLE_TIMEOUT);
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
        cobalt: [{ kind: "error", code: "error.api.timed_out" }, { kind: "ok" }],
      },
      { title: "Track 3", cover: null },
      { title: "Track 4", cover: null },
    ],
  });

  await page.goto("/");
  await importUrl(page, set.url);
  await expect(queueStatus(page, "failed 1/4")).toBeVisible(SETTLE_TIMEOUT);
  await expect(page.getByText("downloads failed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "download all" })).toBeDisabled();

  await page.getByRole("button", { name: "2 Track 2.mp3 track has an error" }).click();
  await expect(page.getByText("download timed out. try again.")).toBeVisible();
  await page.getByRole("button", { name: "3 Track 3.opus" }).click();
  const survivor = await captureDownload(page, () => downloadTrackButton(page).click());
  expect((await inspectAudio(survivor)).metadata).toMatchObject({
    title: "Track 3",
    album: "Partial Set",
    trackNumber: 3,
  });

  await page.getByRole("button", { name: "retry playlist downloads" }).click();
  await expect(page.getByRole("button", { name: "download all" })).toBeEnabled(SETTLE_TIMEOUT);
  await expect(page.getByRole("button", { name: /track has an error/u })).toHaveCount(0);
  await expect(queueStatus(page, "failed 1/4")).toBeHidden();
  const [one, two, three, four] = set.tracks;
  expect(await cobaltRequestCount(upstreams, two!.url)).toBe(2);
  for (const track of [one!, three!, four!]) {
    expect(await cobaltRequestCount(upstreams, track.url)).toBe(1);
  }
});

test("playlist retry skips private, drm and unsupported failures", async ({ page, upstreams }) => {
  const failures = [
    {
      title: "Private",
      code: "error.api.content.video.private",
      detail: "media is private, unavailable, or no longer exists.",
    },
    {
      title: "Protected",
      code: "error.api.youtube.drm",
      detail: "this media is drm-protected and can't be downloaded.",
    },
    {
      title: "Unsupported",
      code: "error.api.service.unsupported",
      detail: "this link is not supported.",
    },
  ];
  const set = await upstreams.soundcloud.set({
    title: "Mixed Failures",
    artwork: null,
    tracks: [
      { title: "Success", cover: null },
      {
        title: "Transient",
        cover: null,
        cobalt: [{ kind: "error", code: "error.api.timed_out" }, { kind: "ok" }],
      },
      ...failures.map(({ title, code }) => ({
        title,
        cover: null,
        cobalt: [{ kind: "error" as const, code }, { kind: "ok" as const }],
      })),
    ],
  });
  await page.goto("/");
  await importUrl(page, set.url);
  await expect(queueStatus(page, "failed 4/5")).toBeVisible(SETTLE_TIMEOUT);
  await page.getByRole("button", { name: "retry playlist downloads" }).click();
  await expect(page.getByRole("button", { name: "2 Transient.mp3", exact: true })).toBeVisible(
    SETTLE_TIMEOUT,
  );
  await page.getByRole("button", { name: "2 Transient.mp3", exact: true }).click();
  await expect(downloadTrackButton(page)).toBeEnabled(SETTLE_TIMEOUT);
  await expect(page.getByRole("button", { name: /track has an error$/u })).toHaveCount(3);
  expect(await cobaltRequestCount(upstreams, set.tracks[1]!.url)).toBe(2);
  expect(await cobaltRequestCount(upstreams, set.tracks[0]!.url)).toBe(1);
  for (const [index, failure] of failures.entries()) {
    expect(await cobaltRequestCount(upstreams, set.tracks[index + 2]!.url)).toBe(1);
    await page
      .getByRole("button", { name: `${index + 3} ${failure.title}.mp3 track has an error` })
      .click();
    await expect(page.getByText(failure.detail, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "download all" })).toBeDisabled();
});

test("a legacy youtube playlist uses its common video artist and each upload year", async ({
  page,
  context,
  upstreams,
}) => {
  await useSettings(context, {
    audioFormat: "best",
    metadataLinks: {
      artist: false,
      year: false,
      genre: false,
      artwork: false,
      albumArtist: false,
      singleAlbum: false,
    },
  });
  const playlist = await upstreams.youtube.playlist({
    title: "Common Artist",
    author: "Playlist Curator",
    renderer: "legacy",
    videos: [
      { title: "Earlier", author: "Performer - Topic", year: 2010, cover: null },
      { title: "Later", author: "Performer", year: 2020, cover: null },
    ],
  });
  await page.goto("/");
  await importUrl(page, playlist.url);
  await expect(
    page.getByRole("button", { name: "Common Artist Performer · 2 tracks" }),
  ).toBeVisible();
  await expect(queueStatus(page, "downloaded 2/2")).toBeVisible(SETTLE_TIMEOUT);
  for (const [index, video] of playlist.videos.entries()) {
    await page.getByRole("button", { name: `${index + 1} ${video.title}.m4a` }).click();
    await expect(field(page, "artist")).toHaveValue("Performer");
    await expect(numberField(page, "year")).toHaveValue(String(video.year));
    const file = await captureDownload(page, () => downloadTrackButton(page).click());
    expect((await inspectAudio(file)).metadata).toMatchObject({
      artist: "Performer",
      albumArtist: "Performer",
      year: video.year,
    });
  }
});

test("mixed youtube artists leave album artist empty when linking is off and preserve missing years", async ({
  page,
  context,
  upstreams,
}) => {
  await useSettings(context, {
    audioFormat: "best",
    metadataLinks: {
      artist: false,
      year: false,
      genre: false,
      artwork: false,
      albumArtist: false,
      singleAlbum: false,
    },
  });
  const playlist = await upstreams.youtube.playlist({
    title: "Undated Playlist",
    author: "Curator",
    videos: [
      { title: "Undated", author: "First", cover: null },
      { title: "Dated", author: "Second - Topic", year: 2022, cover: null },
    ],
  });
  await page.goto("/");
  await importUrl(page, playlist.url);
  await expect(queueStatus(page, "downloaded 2/2")).toBeVisible(SETTLE_TIMEOUT);
  for (const [index, video] of playlist.videos.entries()) {
    await page.getByRole("button", { name: `${index + 1} ${video.title}.m4a` }).click();
    const file = await captureDownload(page, () => downloadTrackButton(page).click());
    expect((await inspectAudio(file)).metadata).toMatchObject({
      artist: video.author.replace(/ - Topic$/u, ""),
      albumArtist: "",
      year: video.year ?? null,
    });
  }
});

test("youtube playlist year lookups wait for downloads and fall back when a lookup fails", async ({
  page,
  context,
  upstreams,
}) => {
  await useSettings(context, { audioFormat: "best" });
  const playlist = await upstreams.youtube.playlist({
    title: "Lazy Years",
    videos: [
      { title: "Fallback Source", author: "First", year: 2011, cover: null },
      {
        title: "Unavailable Date",
        author: "Second",
        year: 1999,
        uploadYearStatus: 403,
        cover: null,
      },
    ],
  });
  const plans = await holdDownloadPlans(page);
  await page.goto("/");
  await importUrl(page, playlist.url);
  await expect(queueStatus(page, "downloading 0/2")).toBeVisible();
  await expect.poll(() => plans.requested().length).toBe(2);
  const lookups = await upstreams.calls({ route: "youtube.next" });
  expect(lookups).toHaveLength(1);
  expect(JSON.parse(lookups[0]!.requestBody!).videoId).toBe(playlist.videos[0]!.id);
  expect(await upstreams.calls({ route: "cobalt.resolve" })).toHaveLength(0);
  await plans.releaseAll();
  await expect(queueStatus(page, "downloaded 2/2")).toBeVisible(SETTLE_TIMEOUT);
  const failedLookups = await upstreams.calls({
    route: "youtube.next",
    key: playlist.videos[1]!.key,
  });
  expect(failedLookups).toHaveLength(1);
  expect(failedLookups[0]!.status).toBe(403);
  for (const [index, video] of playlist.videos.entries()) {
    await page.getByRole("button", { name: `${index + 1} ${video.title}.m4a` }).click();
    const file = await captureDownload(page, () => downloadTrackButton(page).click());
    expect((await inspectAudio(file)).metadata).toMatchObject({ title: video.title, year: 2011 });
  }
});
