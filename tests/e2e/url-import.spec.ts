import { FAKE_COBALT_MACHINE_ID } from "./harness/protocol.ts";
import { captureDownload, inspectAudio } from "./support/audio";
import { expect, IMPORT_TIMEOUT, test } from "./support/test";

test("imports a youtube link with prefilled tags and exports a tagged mp3", async ({
  page,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({
    title: "Night Drive",
    author: "Synth Person - Topic",
    year: 2019,
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "media url" }).fill(video.url);
  await page.getByRole("button", { name: "start media import" }).click();

  await expect(page.getByLabel("title", { exact: true })).toHaveValue("Night Drive");
  await expect(page.getByLabel("artist", { exact: true })).toHaveValue("Synth Person");
  await expect(page.getByLabel("year", { exact: true })).toHaveValue("2019");
  const download = page.getByRole("button", { name: "download track" });
  await expect(download).toBeEnabled(IMPORT_TIMEOUT);
  await expect(page.getByText(/duration: 0:02/u)).toBeVisible();

  const exported = await captureDownload(page, () => download.click());
  expect(exported.filename).toBe("Night Drive.mp3");
  const { format, metadata } = await inspectAudio(exported);
  expect(format).toBe("mp3");
  expect(metadata).toMatchObject({
    title: "Night Drive",
    artist: "Synth Person",
    album: "Night Drive",
    year: 2019,
  });
  expect(metadata.duration).toBeCloseTo(video.durationSec, 0);
  expect(metadata.picture).toHaveLength(1);

  const [resolve] = await upstreams.calls({ route: "cobalt.resolve" });
  expect(JSON.parse(resolve!.requestBody!)).toMatchObject({
    url: video.url,
    downloadMode: "audio",
    audioFormat: "mp3",
    audioBitrate: "320",
    localProcessing: "forced",
  });
  const [tunnel] = await upstreams.calls({ route: "cobalt.tunnel.audio" });
  expect(tunnel!.requestHeaders["fly-force-instance-id"]).toBe(FAKE_COBALT_MACHINE_ID);
});

test("shows why a youtube link cannot be downloaded", async ({ page, upstreams }) => {
  const video = await upstreams.youtube.video({ title: "Gone Song", author: "Someone" });
  await upstreams.cobalt.fail(video.url, "error.api.content.video.unavailable");

  await page.goto("/");
  await page.getByRole("textbox", { name: "media url" }).fill(video.url);
  await page.getByRole("button", { name: "start media import" }).click();

  await expect(page.getByText("we could not access this media").first()).toBeVisible();
  await expect(page.getByText("media is private, unavailable, or no longer exists.")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: /notifications/iu })
      .getByText("check that the link is public and still available, then try again."),
  ).toBeVisible();
  await expect(page.getByLabel("title", { exact: true })).toHaveValue("Gone Song");
  await expect(page.getByRole("button", { name: "download track" })).toBeDisabled();
});
