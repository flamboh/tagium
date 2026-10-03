import type { Request } from "@playwright/test";
import type { MediaProbe } from "../support/media";
import { probeMedia } from "../support/media";
import { expect, test } from "../support/test";
import { saveApp } from "./save";

test.describe.configure({ timeout: 120_000 });

const expectDecoded = (media: MediaProbe) => {
  for (const stream of media.streams) {
    expect(stream.packets, `${stream.codec} packets`).toBeGreaterThan(0);
    if (stream.codec !== "vp9") expect(stream.frames, `${stream.codec} frames`).toBeGreaterThan(0);
  }
};

test("saves a youtube video with audio as a tagged mp4", async ({ page, upstreams }) => {
  const video = await upstreams.youtube.video({ title: "Harbor Lights", author: "Night Channel" });
  const save = saveApp(page);
  const filename = "Harbor Lights - Night Channel (1080p, h264, youtube).mp4";
  let downloads = 0;
  page.on("download", () => {
    downloads += 1;
  });
  const tunnelRequests: Request[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/cobalt/tunnel") tunnelRequests.push(request);
  });

  await save.open();
  await save.save(video.url, filename);

  await expect(save.url).toHaveValue("");
  await expect(save.submit).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "download ready:" })).toHaveText(
    `download ready: ${filename}`,
  );
  await expect(save.rows.locator("img[data-save-download-cover-state=loaded]")).toHaveCount(1);
  expect(downloads).toBe(0);

  const media = await probeMedia(await save.download(filename));
  expect(media.container).toContain("mp4");
  expect(media.streams).toEqual([
    expect.objectContaining({ type: "video", codec: "h264", width: 1920, height: 1080 }),
    expect.objectContaining({ type: "audio", codec: "aac" }),
  ]);
  expectDecoded(media);
  expect(media.duration).toBeCloseTo(2, 0);
  expect(media.tags).toMatchObject({ title: "Harbor Lights", artist: "Night Channel" });

  expect(tunnelRequests).toHaveLength(2);
  await Promise.all(tunnelRequests.map((request) => request.response()));
  const tunnelStarts = tunnelRequests.map((request) => request.timing().startTime);
  expect(Math.abs(tunnelStarts[1]! - tunnelStarts[0]!)).toBeGreaterThanOrEqual(1_000);
  const [resolve] = await upstreams.calls({ route: "cobalt.resolve" });
  expect(JSON.parse(resolve!.requestBody!)).toMatchObject({
    url: video.url,
    downloadMode: "auto",
    videoQuality: "1080",
    youtubeVideoContainer: "mp4",
    youtubeVideoCodec: "h264",
    audioFormat: "best",
    filenameStyle: "pretty",
    localProcessing: "forced",
    alwaysProxy: true,
  });
});

test("quality, codec, and container settings shape the saved video", async ({
  page,
  upstreams,
}) => {
  test.slow();
  const video = await upstreams.youtube.video({
    title: "Tide Pools",
    author: "Coastline",
    video: ["h264-1080", "h264-720", "h264-480", "vp9-720", "av1-720"],
  });
  const save = saveApp(page);
  const mode = page.getByLabel("mode", { exact: true });
  const quality = page.getByLabel("quality", { exact: true });
  const container = page.getByLabel("container", { exact: true });
  const codec = page.getByLabel("codec", { exact: true });

  await save.open();
  await save.settings.click();
  await expect(mode).toHaveValue("auto");
  await expect(quality).toHaveValue("1080");
  await expect(container).toHaveValue("mp4");
  await expect(codec).toHaveValue("h264");
  await expect(page.getByLabel("audio", { exact: true })).toHaveValue("best");
  await container.selectOption("webm");
  await expect(codec).toHaveValue("vp9");
  await codec.selectOption("h264");
  await expect(container).toHaveValue("mp4");
  await codec.selectOption("av1");
  await expect(container).toHaveValue("webm");
  await container.selectOption("mkv");
  await codec.selectOption("h264");
  await expect(container).toHaveValue("mkv");
  await container.selectOption("mp4");
  await expect(codec).toHaveValue("h264");
  await page.keyboard.press("Escape");

  await save.configure({ quality: "720", container: "webm" });
  await save.save(video.url, "Tide Pools - Coastline (720p, vp9, youtube).webm");
  const vp9 = await probeMedia(
    await save.download("Tide Pools - Coastline (720p, vp9, youtube).webm"),
  );
  expect(vp9.container).toContain("webm");
  expect(vp9.streams).toEqual([
    expect.objectContaining({ type: "video", codec: "vp9", width: 1280, height: 720 }),
    expect.objectContaining({ type: "audio", codec: "opus" }),
  ]);
  expectDecoded(vp9);
  expect(vp9.tags).toMatchObject({ title: "Tide Pools", artist: "Coastline" });

  await save.configure({ codec: "av1" });
  await save.save(video.url, "Tide Pools - Coastline (720p, av1, youtube).webm");
  const av1 = await probeMedia(
    await save.download("Tide Pools - Coastline (720p, av1, youtube).webm"),
  );
  expect(av1.streams).toEqual([
    expect.objectContaining({ type: "video", codec: "av1", width: 1280, height: 720 }),
    expect.objectContaining({ type: "audio", codec: "opus" }),
  ]);
  expectDecoded(av1);

  await save.configure({ container: "mkv", codec: "h264", quality: "480" });
  await save.save(video.url, "Tide Pools - Coastline (480p, h264, youtube).mkv");
  const mkv = await probeMedia(
    await save.download("Tide Pools - Coastline (480p, h264, youtube).mkv"),
  );
  expect(mkv.container).toContain("matroska");
  expect(mkv.streams).toEqual([
    expect.objectContaining({ type: "video", codec: "h264", width: 854, height: 480 }),
    expect.objectContaining({ type: "audio", codec: "aac" }),
  ]);
  expectDecoded(mkv);
  expect(mkv.tags).toMatchObject({ title: "Tide Pools", artist: "Coastline" });

  const requests = (await upstreams.calls({ route: "cobalt.resolve" })).map((call) =>
    JSON.parse(call.requestBody!),
  );
  expect(requests).toEqual([
    expect.objectContaining({
      videoQuality: "720",
      youtubeVideoContainer: "webm",
      youtubeVideoCodec: "vp9",
    }),
    expect.objectContaining({
      videoQuality: "720",
      youtubeVideoContainer: "webm",
      youtubeVideoCodec: "av1",
    }),
    expect.objectContaining({
      videoQuality: "480",
      youtubeVideoContainer: "mkv",
      youtubeVideoCodec: "h264",
    }),
  ]);
});

test("saves a youtube video without its audio track and keeps its tags", async ({
  page,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({ title: "Quiet Room", author: "Still Life" });
  const save = saveApp(page);
  const filename = "Quiet Room - Still Life (1080p, h264, mute, youtube).mp4";

  await save.open();
  await save.configure({ mode: "mute" });
  await save.save(video.url, filename);

  const media = await probeMedia(await save.download(filename));
  expect(media.container).toContain("mp4");
  expect(media.streams).toEqual([
    expect.objectContaining({ type: "video", codec: "h264", width: 1920, height: 1080 }),
  ]);
  expectDecoded(media);
  expect(media.tags).toMatchObject({ title: "Quiet Room", artist: "Still Life" });
  expect(await upstreams.calls({ route: "cobalt.tunnel.audio" })).toHaveLength(0);
  const [resolve] = await upstreams.calls({ route: "cobalt.resolve" });
  expect(JSON.parse(resolve!.requestBody!)).toMatchObject({ downloadMode: "mute" });
});
