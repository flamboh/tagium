import { imageFixtures } from "../fixtures/catalog.ts";
import { captureDownload, inspectAudio, unzipDownload } from "../support/audio";
import { JOURNEY_TIMEOUT, test } from "../support/test";
import type { Upstreams } from "../support/upstreams";
import {
  audioPreview,
  downloadTrackButton,
  field,
  holdDownloadPlans,
  imageSize,
  importUrl,
  numberField,
  queueStatus,
  soundcloudStreamCount,
  soundcloudStreamKeys,
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

test("a soundcloud set downloads six tracks at a time and removing tracks starts the next one", async ({
  page,
  context,
  upstreams,
}) => {
  await useSettings(context, { audioFormat: "best" });
  const set = await trackSet(upstreams, "Removal Set", 8);
  const urls = set.tracks.map((track) => track.url);
  const plans = await holdDownloadPlans(page);

  await page.goto("/");
  await importUrl(page, set.url);
  await expect(queueStatus(page, "downloading 0/8")).toBeVisible();
  await expect.poll(plans.requested).toEqual(urls.slice(0, 6));
  await expect(page.getByText("+4 more", { exact: true })).toBeVisible();

  await removeTrack(page, "Track 1.mp3");
  await expect(queueStatus(page, "downloading 0/7")).toBeVisible();
  await expect.poll(plans.requested).toEqual(urls.slice(0, 7));

  await removeTrack(page, "Track 8.mp3");
  await expect(queueStatus(page, "downloading 0/6")).toBeVisible();

  await plans.releaseAll();
  await expect(queueStatus(page, "downloaded 6/6")).toBeVisible(SETTLE_TIMEOUT);
  await expect(trackButtons(page)).toHaveText(
    Array.from(
      { length: 6 },
      (_, index) => new RegExp(`^${index + 1}\\s*Track ${index + 2}\\.m4a$`, "u"),
    ),
  );
  await expect(page.getByRole("button", { name: "download all" })).toBeEnabled();
  expect(plans.requested()).not.toContain(urls[7]);
  const streamKeys = await soundcloudStreamKeys(upstreams);
  expect(streamKeys).toHaveLength(6);
  expect(streamKeys).toEqual(
    expect.arrayContaining(set.tracks.slice(1, 7).map((track) => track.key)),
  );
});

test("canceling a playlist keeps its tracks and retry downloads all of them", async ({
  page,
  context,
  upstreams,
}) => {
  await useSettings(context, { audioFormat: "best" });
  const set = await trackSet(upstreams, "Cancel Set", 8);
  const plans = await holdDownloadPlans(page);

  await page.goto("/");
  await importUrl(page, set.url);
  await expect.poll(() => plans.requested().length).toBe(6);

  await page.getByRole("button", { name: "cancel playlist downloads" }).click();
  await expect(queueStatus(page, "canceled 8/8")).toBeVisible();
  await expect(page.getByText("remaining tracks canceled", { exact: true })).toBeVisible();
  await expect(audioPreview(page).getByRole("status")).toHaveText("download canceled");
  await expect(downloadTrackButton(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "download all" })).toBeDisabled();
  await expect(trackButtons(page)).toHaveCount(8);
  await plans.releaseAll();

  await page.getByRole("button", { name: "retry playlist downloads" }).click();
  await expect(queueStatus(page, "downloaded 8/8")).toBeVisible(SETTLE_TIMEOUT);
  await expect(page.getByRole("button", { name: "download all" })).toBeEnabled();
  expect(plans.requested().slice(6).sort()).toEqual(set.tracks.map((track) => track.url).sort());

  for (const track of set.tracks) {
    expect(await soundcloudStreamCount(upstreams, track)).toBe(1);
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
        stream: [{ kind: "status", status: 500 }, { kind: "ok" }],
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
  await expect(page.getByText("the media provider returned an unexpected response.")).toBeVisible();
  await page.getByRole("button", { name: "3 Track 3.m4a" }).click();
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
  expect(await soundcloudStreamCount(upstreams, two!)).toBe(2);

  for (const track of [one!, three!, four!]) {
    expect(await soundcloudStreamCount(upstreams, track)).toBe(1);
  }
});

test("playlist retry skips missing and drm-protected failures", async ({ page, upstreams }) => {
  const set = await upstreams.soundcloud.set({
    title: "Mixed Failures",
    artwork: null,
    tracks: [
      { title: "Success", cover: null },
      {
        title: "Transient",
        cover: null,
        stream: [{ kind: "status", status: 500 }, { kind: "ok" }],
      },
      { title: "Private", cover: null, metadata: { kind: "status", status: 404 } },
      { title: "Protected", cover: null, transcodings: "encrypted" },
    ],
  });

  const failures = [
    { title: "Private", detail: "media is private, unavailable, or no longer exists." },
    { title: "Protected", detail: "this media is drm-protected and can't be downloaded." },
  ];

  await page.goto("/");
  await importUrl(page, set.url);
  await expect(queueStatus(page, "failed 3/4")).toBeVisible(SETTLE_TIMEOUT);
  await page.getByRole("button", { name: "retry playlist downloads" }).click();
  await expect(page.getByRole("button", { name: "2 Transient.mp3", exact: true })).toBeVisible(
    SETTLE_TIMEOUT,
  );
  await page.getByRole("button", { name: "2 Transient.mp3", exact: true }).click();
  await expect(downloadTrackButton(page)).toBeEnabled(SETTLE_TIMEOUT);
  await expect(page.getByRole("button", { name: /track has an error$/u })).toHaveCount(2);
  expect(await soundcloudStreamCount(upstreams, set.tracks[1]!)).toBe(2);
  expect(await soundcloudStreamCount(upstreams, set.tracks[0]!)).toBe(1);

  for (const [index, failure] of failures.entries()) {
    const track = set.tracks[index + 2]!;
    expect(
      await upstreams.calls({ route: "soundcloud.resolve.track", key: track.key }),
    ).toHaveLength(1);
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
