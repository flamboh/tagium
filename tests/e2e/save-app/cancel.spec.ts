import { inspectAudio } from "../support/audio";
import { expect, IMPORT_TIMEOUT, test } from "../support/test";
import { saveApp, storedFileCount } from "./save";

test("cancels a save while it is being prepared and saves another link", async ({
  page,
  upstreams,
}) => {
  const stuck = await upstreams.soundcloud.track({ title: "Stuck Plan", cover: null });

  const next = await upstreams.soundcloud.track({
    title: "Next Track",
    author: "Coast",
    cover: null,
  });

  await upstreams.cobalt.hang(stuck.url);
  const save = saveApp(page);

  await save.open();
  await save.start(stuck.url);
  await expect(save.progress).toHaveAttribute("aria-valuetext", "preparing 0%");
  await expect(save.url).toBeDisabled();
  await expect(save.settings).toBeDisabled();
  await expect(save.submit).toBeDisabled();

  await save.cancel.click();
  await expect(save.progress).toBeHidden();
  await expect(save.alert).toHaveCount(0);
  await expect(save.url).toHaveValue(stuck.url);
  await expect(save.url).toBeEditable();

  await save.save(next.url, "Next Track - Coast (soundcloud).opus");
  await expect(save.rows).toHaveCount(1);
  const file = await save.download("Next Track - Coast (soundcloud).opus");
  expect((await inspectAudio(file)).metadata).toMatchObject({
    title: "Next Track",
    artist: "Coast",
  });
});

test("cancels a save whose media stalls halfway through", async ({ page, upstreams }) => {
  const stalled = await upstreams.soundcloud.track({ title: "Half Way", cover: null });

  const next = await upstreams.soundcloud.track({
    title: "Whole Way",
    author: "Coast",
    cover: null,
  });

  await upstreams.cobalt.stallTunnel(stalled.url);
  const save = saveApp(page);

  await save.open();
  await save.start(stalled.url);
  await expect(save.progress).toHaveAttribute(
    "aria-valuetext",
    /^downloading \d+%$/u,
    IMPORT_TIMEOUT,
  );
  await expect(save.progress).not.toHaveAttribute("aria-valuetext", "downloading 100%");

  await save.cancel.click();
  await expect(save.progress).toBeHidden();
  await expect(save.alert).toHaveCount(0);
  await expect(save.url).toHaveValue(stalled.url);

  await save.save(next.url, "Whole Way - Coast (soundcloud).opus");
  await expect(save.rows).toHaveCount(1);
});

test("cancels a save while its media is being processed", async ({
  page,
  browserName,
  upstreams,
}) => {
  const first = await upstreams.youtube.video({
    title: "Long Encode",
    author: "Studio",
    cover: null,
  });

  const second = await upstreams.youtube.video({ title: "Short Encode", author: "Studio" });
  const save = saveApp(page);
  let releaseLibAV = () => {};

  const libavHeld = new Promise<void>((resolve) => {
    releaseLibAV = resolve;
  });

  await page.route("**/_libav/**", async (route) => {
    await libavHeld;
    await route.fallback();
  });

  await save.open();
  await save.configure({ mode: "audio", audio: "mp3" });
  await save.start(first.url);
  await expect(save.progress).toHaveAttribute("aria-valuetext", /^processing/u, IMPORT_TIMEOUT);

  await save.cancel.click();
  await expect(save.progress).toBeHidden();
  releaseLibAV();

  await save.save(second.url, "Short Encode - Studio (youtube).mp3");
  await expect(save.rows).toHaveCount(1);
  const file = await save.download("Short Encode - Studio (youtube).mp3");
  expect((await inspectAudio(file)).metadata).toMatchObject({ title: "Short Encode" });

  if (browserName !== "webkit") await expect.poll(() => storedFileCount(page)).toBe(1);
});
