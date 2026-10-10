import { imageFixture, inspectAudio } from "../support/audio";
import { probeMedia } from "../support/media";
import { expect, IMPORT_TIMEOUT, test } from "../support/test";
import { saveApp } from "./save";

test("saves each piece of media offered by a post, and its audio", async ({ page, upstreams }) => {
  const post = await upstreams.picker({
    items: [
      { type: "photo", asset: "cover" },
      { type: "video", asset: "h264-aac-480", directFilename: "clip.mp4" },
      { type: "gif", asset: "anim-gif" },
    ],
    audio: { asset: "m4a", filename: "post-audio.m4a" },
  });

  const save = saveApp(page);

  const choose = async (choice: string, filename: string) => {
    await save.start(post.url);
    await expect(page.getByRole("button", { name: "download photo 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "download video 2" })).toBeVisible();
    await expect(page.getByRole("button", { name: "download gif 3" })).toBeVisible();
    await expect(page.getByRole("button", { name: "download post-audio.m4a" })).toBeVisible();
    await expect(save.url).toBeDisabled();
    await expect(save.settings).toBeDisabled();
    await expect(save.submit).toBeDisabled();
    await page.getByRole("button", { name: choice, exact: true }).click();
    await expect(save.downloadButton(filename)).toBeVisible(IMPORT_TIMEOUT);
    await expect(page.getByRole("button", { name: "download photo 1" })).toBeHidden();

    return save.download(filename);
  };

  await save.open();
  const photo = await choose("download photo 1", `twitter_${post.id}_1.jpg`);
  expect(photo.bytes).toEqual(imageFixture("cover").bytes);

  const video = await probeMedia(await choose("download video 2", "clip.mp4"));
  expect(video.streams).toEqual([
    expect.objectContaining({ type: "video", codec: "h264", width: 854, height: 480 }),
    expect.objectContaining({ type: "audio", codec: "aac" }),
  ]);

  const gif = await probeMedia(await choose("download gif 3", `twitter_${post.id}_3.gif`));
  expect(gif.streams).toEqual([expect.objectContaining({ type: "video", codec: "gif" })]);

  const audio = await choose("download post-audio.m4a", "post-audio.m4a");
  expect((await inspectAudio(audio)).format).toBe("m4a");

  await expect(save.rows).toHaveText([
    "post-audio.m4a",
    `twitter_${post.id}_3.gif`,
    "clip.mp4",
    `twitter_${post.id}_1.jpg`,
  ]);
  expect(await upstreams.calls({ route: "media.direct" })).toHaveLength(1);
  expect(await upstreams.calls({ route: "cobalt.tunnel.post" })).toHaveLength(3);
});

test("resetting a post's choices leaves nothing saved", async ({ page, upstreams }) => {
  const post = await upstreams.picker({
    items: [
      { type: "photo", asset: "cover" },
      { type: "photo", asset: "thumbnail" },
    ],
  });

  const save = saveApp(page);

  await save.open();
  await save.start(post.url);
  await expect(page.getByRole("button", { name: "download photo 2" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^download .*audio/u })).toHaveCount(0);

  await save.reset.click();
  await expect(page.getByRole("button", { name: "download photo 1" })).toBeHidden();
  await expect(save.url).toHaveValue("");
  await expect(save.url).toBeEditable();
  await expect(save.recent).toHaveCount(0);
  expect(await upstreams.calls({ route: "cobalt.tunnel.post" })).toHaveLength(0);
});

test("saves a gif post as an animated gif", async ({ page, upstreams }) => {
  const post = await upstreams.gifPost({ asset: "h264-480", filename: "dancing cat.gif" });
  const save = saveApp(page);

  await save.open();
  await save.save(post.url, "dancing cat.gif");

  const gif = await probeMedia(await save.download("dancing cat.gif"));
  expect(gif.container).toBe("gif");
  expect(gif.streams).toEqual([
    expect.objectContaining({ type: "video", codec: "gif", width: 854, height: 480 }),
  ]);
  expect(gif.streams[0]!.frames).toBeGreaterThan(1);
});
