import { randomUUID } from "node:crypto";
import { inspectAudio, retaggedAudioFixture } from "../support/audio";
import { expect, SETTLE_TIMEOUT, test } from "../support/test";
import {
  backToWorkspace,
  downloadTrack,
  editorMode,
  field,
  openSettings,
  pickFiles,
  seedSettings,
} from "./workspace";

const synced = "[00:01.00] first lyric\n[00:02.50] second lyric";

const uniqueTrack = async () => {
  const title = `lyrics ${randomUUID().slice(0, 8)}`;

  const { upload } = await retaggedAudioFixture("mp3", `${title}.mp3`, {
    title,
    artist: "lyrics artist",
    album: "",
    lyrics: "",
  });

  return { title, upload };
};

test("finds synced lyrics for an imported track and tags them on download", async ({
  page,
  upstreams,
}) => {
  const track = await uniqueTrack();

  const key = await upstreams.lyrics(track.title, {
    exact: upstreams.lrclibRecord({
      trackName: track.title,
      artistName: "lyrics artist",
      plainLyrics: "first lyric\nsecond lyric",
      syncedLyrics: synced,
    }),
  });

  await seedSettings(page, { findLyrics: true });
  await page.goto("/");
  await pickFiles(page, [track.upload]);

  await expect(field(page, "lyrics")).toHaveValue(synced, SETTLE_TIMEOUT);

  const [lookup] = await upstreams.calls({ key, route: "lrclib.get" });
  expect(new URL(lookup!.url).searchParams.has("album_name")).toBe(false);
  expect(lookup!.requestHeaders["lrclib-app-id"]).toBeTruthy();

  const { metadata } = await inspectAudio(await downloadTrack(page));
  expect(metadata).toMatchObject({ title: track.title, lyrics: synced });
});

test("falls back to a duration matched search and rides out a busy lrclib", async ({
  page,
  upstreams,
}) => {
  const track = await uniqueTrack();
  await seedSettings(page, { findLyrics: true, advancedMetadata: true });
  await page.goto("/");

  const { metadata: source } = await inspectAudio({
    filename: track.upload.name,
    bytes: new Uint8Array(track.upload.buffer),
  });

  const key = await upstreams.lyrics(track.title, {
    busy: [503, "ok"],
    search: [
      upstreams.lrclibRecord({ duration: source.duration + 30, plainLyrics: "wrong length" }),
      upstreams.lrclibRecord({ duration: source.duration, plainLyrics: "plain lyric" }),
    ],
  });

  await pickFiles(page, [track.upload]);
  await editorMode(page, "advanced").click();
  await expect(field(page, "lyrics")).toHaveValue("plain lyric", SETTLE_TIMEOUT);
  expect((await upstreams.calls({ key })).map((call) => [call.route, call.status])).toEqual([
    ["lrclib.get", 503],
    ["lrclib.get", 404],
    ["lrclib.search", 200],
  ]);
});

test("leaves lyrics alone until find lyrics is turned on in settings", async ({
  page,
  upstreams,
}) => {
  const track = await uniqueTrack();
  const key = await upstreams.lyrics(track.title);
  await seedSettings(page, { advancedMetadata: true });
  await page.goto("/");
  await pickFiles(page, [track.upload]);
  await expect(field(page, "title")).toHaveValue(track.title);
  expect(await upstreams.calls({ key })).toEqual([]);

  await openSettings(page, "editing");
  await page.getByRole("checkbox", { name: /^find lyrics/u }).click();
  await backToWorkspace(page);

  await expect.poll(async () => (await upstreams.calls({ key })).length).toBe(2);
  await editorMode(page, "advanced").click();
  await expect(field(page, "lyrics")).toHaveValue("");
  await expect(field(page, "lyrics")).toHaveAttribute(
    "placeholder",
    "paste plain or synced lrc lyrics",
  );

  await page.reload();
  await openSettings(page, "editing");
  await expect(page.getByRole("checkbox", { name: /^find lyrics/u })).toBeChecked();
});
