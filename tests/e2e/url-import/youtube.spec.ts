import { imageFixtures } from "../fixtures/catalog.ts";
import { FAKE_COBALT_MACHINE_ID } from "../harness/protocol.ts";
import {
  captureDownload,
  expectLosslessAudio,
  inspectAudio,
  unzipDownload,
} from "../support/audio";
import { expectDownloadName, test } from "../support/test";
import type { FakeYouTubeVideo } from "../support/upstreams";
import {
  audioPreview,
  cobaltRequests,
  downloadTrackButton,
  field,
  imageSize,
  importUrl,
  numberField,
  waitForTrackReady,
  expect,
  SETTLE_TIMEOUT,
} from "./helpers";

test("imports a youtube video with prefilled tags, then edits and exports the same audio", async ({
  page,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({
    title: "Night Drive",
    author: "Synth Person - Topic",
    year: 2019,
  });

  await page.goto("/");
  await importUrl(page, video.url);

  await expect(field(page, "title")).toHaveValue("Night Drive");
  await expect(field(page, "artist")).toHaveValue("Synth Person");
  await expect(field(page, "album")).toHaveValue("Night Drive");
  await waitForTrackReady(page);
  await expect(numberField(page, "year")).toHaveValue("2019");
  await expect(audioPreview(page)).toContainText("0:00 / 0:02");
  await expect(page.getByRole("img", { name: "album cover" })).toBeVisible();

  const original = await captureDownload(page, () => downloadTrackButton(page).click());
  expectDownloadName(original, "Night Drive.mp3");
  const imported = await inspectAudio(original);
  expect(imported.format).toBe("mp3");
  expect(imported.metadata).toMatchObject({
    title: "Night Drive",
    artist: "Synth Person",
    albumArtist: "Synth Person",
    album: "Night Drive",
    year: 2019,
  });
  expect(imported.metadata.duration).toBeCloseTo(video.durationSec, 0);
  expect(imported.metadata.picture).toHaveLength(1);
  expect(imageSize(imported.metadata.picture[0]!.data)).toEqual({ width: 720, height: 720 });

  await field(page, "title").fill("zoo café 日本語");
  await field(page, "artist").fill("qa artist");
  await numberField(page, "year").fill("2024");
  await field(page, "genre").fill("test genre");
  await numberField(page, "track").fill("3");
  await expect(field(page, "album")).toHaveValue("zoo café 日本語");

  const edited = await captureDownload(page, () => downloadTrackButton(page).click());
  expectDownloadName(edited, "zoo café 日本語.mp3");
  expect((await inspectAudio(edited)).metadata).toMatchObject({
    title: "zoo café 日本語",
    album: "zoo café 日本語",
    artist: "qa artist",
    albumArtist: "qa artist",
    year: 2024,
    genre: "test genre",
    trackNumber: 3,
  });
  await expectLosslessAudio(edited, original);

  expect(await cobaltRequests(upstreams)).toEqual([
    expect.objectContaining({
      url: video.url,
      downloadMode: "audio",
      audioFormat: "mp3",
      audioBitrate: "320",
      alwaysProxy: true,
      localProcessing: "forced",
      filenameStyle: "pretty",
      youtubeHLS: false,
    }),
  ]);
  const [tunnel] = await upstreams.calls({ route: "cobalt.tunnel.audio" });
  expect(tunnel!.requestHeaders["fly-force-instance-id"]).toBe(FAKE_COBALT_MACHINE_ID);
});

test("crops youtube topic covers square like tagium save and keeps other covers whole", async ({
  page,
  upstreams,
}) => {
  const topic = await upstreams.youtube.video({ title: "Square", author: "Label Act - Topic" });
  const upload = await upstreams.youtube.video({ title: "Wide", author: "Vlogger" });

  const exportedCover = async (url: string) => {
    await page.goto("/");
    await importUrl(page, url);
    await waitForTrackReady(page);
    const exported = await captureDownload(page, () => downloadTrackButton(page).click());
    const { picture } = (await inspectAudio(exported)).metadata;
    expect(picture).toHaveLength(1);

    return picture[0]!;
  };

  const square = await exportedCover(topic.url);
  expect(square.format).toBe("image/jpeg");
  expect(imageSize(square.data)).toEqual({ width: 720, height: 720 });

  const wide = await exportedCover(upload.url);
  expect(imageSize(wide.data)).toEqual({
    width: imageFixtures.thumbnail.width,
    height: imageFixtures.thumbnail.height,
  });
});

test("downloads a freshly imported youtube single as a zip on the first confirmation", async ({
  page,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({
    title: "First Try",
    author: "Someone",
    year: 2005,
  });

  await page.goto("/");
  await importUrl(page, video.url);
  await expect(page.getByRole("button", { name: "download all" })).toBeEnabled(SETTLE_TIMEOUT);
  await page.getByRole("button", { name: "download all" }).click();

  const dialog = page.getByRole("dialog", { name: "download 1 track" });

  const archive = await captureDownload(page, () =>
    dialog.getByRole("button", { name: /^download ~/u }).click(),
  );

  await expect(dialog).toBeHidden();
  expect(archive.filename).toMatch(/^tagium-download-.+\.zip$/u);
  const [entry, ...rest] = unzipDownload(archive);
  expect(rest).toHaveLength(0);
  expect(entry!.filename).toBe("singles/First Try.mp3");
  expect((await inspectAudio(entry!)).metadata).toMatchObject({
    title: "First Try",
    artist: "Someone",
    albumArtist: "Someone",
    year: 2005,
  });
});

const linkVariants: [string, (video: FakeYouTubeVideo) => string][] = [
  ["mobile", (video) => `https://m.youtube.com/watch?v=${video.id}`],
  ["music", (video) => `https://music.youtube.com/watch?v=${video.id}`],
  ["short link with a timestamp", (video) => `${video.shortUrl}?t=10`],
  [
    "watch link with a timestamp and playlist",
    (video) => `${video.url}&t=10s&list=PLe2eUnusedPlaylist&index=2`,
  ],
];

for (const [variant, linkFor] of linkVariants) {
  test(`imports the whole single video from a youtube ${variant}`, async ({ page, upstreams }) => {
    const video = await upstreams.youtube.video({
      title: `Variant ${variant}`,
      author: "Linker",
      cover: null,
    });

    await page.goto("/");
    await importUrl(page, linkFor(video));
    await waitForTrackReady(page);

    await expect(page.getByText("library (1)")).toBeVisible();
    await expect(field(page, "title")).toHaveValue(`Variant ${variant}`);
    await expect(audioPreview(page)).toContainText("0:00 / 0:02");
    expect((await cobaltRequests(upstreams)).map((request) => request.url)).toEqual([video.url]);
    const [oembed] = await upstreams.calls({ route: "youtube.oembed" });
    expect(new URL(oembed!.url).searchParams.get("url")).toBe(video.url);
    expect(await upstreams.calls({ route: "youtube.playlist" })).toHaveLength(0);
  });
}
