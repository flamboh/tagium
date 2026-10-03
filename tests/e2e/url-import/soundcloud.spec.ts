import { imageFixtures, type ImageFixtureName } from "../fixtures/catalog.ts";
import { captureDownload, inspectAudio, unzipDownload } from "../support/audio";
import { expect, IMPORT_TIMEOUT, test } from "../support/test";
import {
  audioPreview,
  cobaltRequests,
  downloadTrackButton,
  field,
  holdDownloadPlans,
  imageSize,
  importUrl,
  numberField,
  queueStatus,
  useSettings,
  waitForTrackReady,
} from "./helpers";

const sizeOf = (image: ImageFixtureName) => ({
  width: imageFixtures[image].width,
  height: imageFixtures[image].height,
});

test("imports a soundcloud track with its provider tags and exports it in a zip", async ({
  page,
  upstreams,
}) => {
  const track = await upstreams.soundcloud.track({
    title: "Introitus",
    author: "Forss",
    genre: "Electronic",
    year: 2012,
  });

  await page.goto("/");
  await importUrl(page, `  ${track.url}  `);
  await waitForTrackReady(page);

  await expect(field(page, "title")).toHaveValue("Introitus");
  await expect(field(page, "artist")).toHaveValue("Forss");
  await expect(field(page, "album")).toHaveValue("Introitus");
  await expect(field(page, "genre")).toHaveValue("Electronic");
  await expect(numberField(page, "year")).toHaveValue("2012");
  await expect(numberField(page, "track")).toHaveValue("");
  await expect(audioPreview(page)).toContainText("0:00 / 0:02");

  await page.getByRole("button", { name: "download all" }).click();
  const archive = await captureDownload(page, () =>
    page
      .getByRole("dialog", { name: "download 1 track" })
      .getByRole("button", { name: /^download ~/u })
      .click(),
  );
  const [entry, ...rest] = unzipDownload(archive);
  expect(rest).toHaveLength(0);
  expect(entry!.filename).toBe("singles/Introitus.mp3");
  const { format, metadata } = await inspectAudio(entry!);
  expect(format).toBe("mp3");
  expect(metadata).toMatchObject({
    title: "Introitus",
    artist: "Forss",
    albumArtist: "Forss",
    album: "Introitus",
    genre: "Electronic",
    year: 2012,
  });
  expect(metadata.duration).toBeCloseTo(track.durationSec, 0);
  expect(imageSize(metadata.picture[0]!.data)).toEqual(sizeOf("artwork"));
});

test("imports a soundcloud album in order with album tags, seconds durations and the album cover", async ({
  page,
  upstreams,
}) => {
  const set = await upstreams.soundcloud.set({
    title: "Ecclesia",
    author: "Forss",
    genre: "Electronic",
    displayDate: "2012-04-02T00:00:00Z",
    isAlbum: true,
    artwork: "artwork",
    tracks: [
      { title: "Introitus", durationSec: 98.475, cover: "cover" },
      { title: "Kyrie", durationSec: 123, cover: "cover", stub: true },
      { title: "Gloria", cover: "cover" },
    ],
  });
  const plans = await holdDownloadPlans(page);

  await page.goto("/");
  await importUrl(page, set.url);

  await expect(page.getByRole("button", { name: "Ecclesia Forss · 3 tracks" })).toBeVisible();
  await expect(queueStatus(page, "downloading 0/3")).toBeVisible();
  await expect(page.getByRole("button", { name: /^\d .+\.mp3$/u })).toHaveText([
    /^1\s*Introitus\.mp3$/u,
    /^2\s*Kyrie\.mp3$/u,
    /^3\s*Gloria\.mp3$/u,
  ]);
  await expect(field(page, "title")).toHaveValue("Introitus");
  await expect(field(page, "album")).toHaveValue("Ecclesia");
  await expect(field(page, "artist")).toHaveValue("Forss");
  await expect(field(page, "genre")).toHaveValue("Electronic");
  await expect(numberField(page, "year")).toHaveValue("2012");
  await expect(numberField(page, "track")).toHaveValue("1");
  await expect(audioPreview(page)).toContainText("0:00 / 1:38");
  await page.getByRole("button", { name: "2 Kyrie.mp3" }).click();
  await expect(audioPreview(page)).toContainText("0:00 / 2:03");
  await expect.poll(plans.requested).toEqual(set.tracks.map((track) => track.url));

  await plans.releaseAll();
  await expect(queueStatus(page, "downloaded 3/3")).toBeVisible(IMPORT_TIMEOUT);
  await page.getByRole("button", { name: "download all" }).click();
  const archive = await captureDownload(page, () =>
    page
      .getByRole("dialog", { name: "download 3 tracks" })
      .getByRole("button", { name: /^download ~/u })
      .click(),
  );
  const entries = unzipDownload(archive);
  expect(entries.map((entry) => entry.filename).sort()).toEqual([
    "albums/Ecclesia/Gloria.mp3",
    "albums/Ecclesia/Introitus.mp3",
    "albums/Ecclesia/Kyrie.mp3",
    "albums/Ecclesia/cover.png",
  ]);
  for (const [index, title] of ["Introitus", "Kyrie", "Gloria"].entries()) {
    const entry = entries.find((file) => file.filename === `albums/Ecclesia/${title}.mp3`)!;
    const { metadata } = await inspectAudio(entry);
    expect(metadata).toMatchObject({
      title,
      album: "Ecclesia",
      artist: "Forss",
      albumArtist: "Forss",
      genre: "Electronic",
      year: 2012,
      trackNumber: index + 1,
    });
    expect(imageSize(metadata.picture[0]!.data)).toEqual(sizeOf("artwork"));
  }
});

for (const { name, isAlbum, albumCover } of [
  { name: "a non-album soundcloud set", isAlbum: false, albumCover: true },
  { name: "an album with the album cover setting off", isAlbum: true, albumCover: false },
]) {
  test(`keeps each track's own cover for ${name}`, async ({ page, context, upstreams }) => {
    await useSettings(context, { applySoundCloudAlbumCoverToTracks: albumCover });
    const set = await upstreams.soundcloud.set({
      title: "Remixes",
      author: "Forss",
      isAlbum,
      artwork: "artwork",
      displayDate: "2008-05-01T00:00:00Z",
      tracks: [
        { title: "Speech Craft", cover: "cover" },
        { title: "Basscheck", cover: "cover" },
      ],
    });

    await page.goto("/");
    await importUrl(page, set.url);
    await expect(page.getByRole("button", { name: "Remixes Forss · 2 tracks" })).toBeVisible();
    await expect(queueStatus(page, "downloaded 2/2")).toBeVisible(IMPORT_TIMEOUT);

    await expect(field(page, "album")).toHaveValue("Remixes");
    await expect(numberField(page, "track")).toHaveValue("1");
    const exported = await captureDownload(page, () => downloadTrackButton(page).click());
    expect(exported.filename).toBe("Speech Craft.mp3");
    const { metadata } = await inspectAudio(exported);
    expect(metadata).toMatchObject({
      title: "Speech Craft",
      album: "Remixes",
      artist: "Forss",
      year: 2008,
      trackNumber: 1,
    });
    expect(imageSize(metadata.picture[0]!.data)).toEqual(sizeOf("cover"));
  });
}

test("resolves soundcloud short links to the canonical track and set", async ({
  page,
  upstreams,
}) => {
  const track = await upstreams.soundcloud.track({
    title: "Short Track",
    author: "Shorty",
    cover: null,
  });
  const set = await upstreams.soundcloud.set({
    title: "Short Set",
    author: "Shorty",
    artwork: null,
    tracks: [
      { title: "Set One", cover: null },
      { title: "Set Two", cover: null },
    ],
  });
  const trackLink = await upstreams.soundcloud.shortLink(track.url);
  const setLink = await upstreams.soundcloud.shortLink(set.url);

  await page.goto("/");
  await importUrl(page, trackLink);
  await expect(field(page, "title")).toHaveValue("Short Track");
  await waitForTrackReady(page);

  await importUrl(page, setLink);
  await expect(page.getByRole("button", { name: "Short Set Shorty · 2 tracks" })).toBeVisible();
  await expect(queueStatus(page, "downloaded 2/2")).toBeVisible(IMPORT_TIMEOUT);

  expect((await cobaltRequests(upstreams)).map((request) => request.url).sort()).toEqual(
    [track.url, ...set.tracks.map((setTrack) => setTrack.url)].sort(),
  );
  expect(await upstreams.calls({ route: "soundcloud.short_link" })).toHaveLength(2);
});
