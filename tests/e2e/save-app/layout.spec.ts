import { expect, test } from "../support/test";
import { saveApp } from "./save";

const sizes = [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 667, height: 375 },
  { width: 568, height: 320 },
];

test("five recent saves stay readable and clear of the attribution on every screen", async ({
  page,
  upstreams,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const tracks = await Promise.all(
    ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((title) =>
      upstreams.soundcloud.track({ title, author: "Stack", cover: null }),
    ),
  );
  const save = saveApp(page);
  const attribution = page.locator("footer");

  await save.open();
  for (const track of tracks)
    await save.save(track.url, `${track.title} - Stack (soundcloud).opus`);

  for (const size of sizes) {
    await page.setViewportSize(size);
    await attribution.scrollIntoViewIfNeeded();
    await expect(attribution).toBeInViewport();
    const footer = (await attribution.boundingBox())!;
    for (const row of await save.rows.all()) {
      const box = (await row.boundingBox())!;
      expect(
        box.y + box.height,
        `row above attribution at ${size.width}x${size.height}`,
      ).toBeLessThanOrEqual(footer.y);
    }
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main:
        document.querySelector("main")!.scrollWidth - document.querySelector("main")!.clientWidth,
    }));
    expect(overflow, `horizontal overflow at ${size.width}x${size.height}`).toEqual({
      document: 0,
      main: 0,
    });
    const lastDownload = save.recent.getByRole("button").last();
    await lastDownload.scrollIntoViewIfNeeded();
    await expect(lastDownload).toBeInViewport();
  }
});

test("save controls stay reachable on a phone while working and after an error", async ({
  page,
  upstreams,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const stuck = await upstreams.soundcloud.track({ cover: null });
  const failing = await upstreams.soundcloud.track({ cover: null });
  await upstreams.cobalt.hang(stuck.url);
  await upstreams.cobalt.capacity(failing.url);
  const save = saveApp(page);

  await save.open();
  await save.start(stuck.url);
  await expect(save.progress).toBeInViewport();
  await expect(save.cancel).toBeInViewport();
  await save.cancel.click();

  await save.start(failing.url);
  await expect(save.alert).toHaveText("downloads are busy. try again in a moment.");
  await expect(save.retry).toBeInViewport();
  await expect(save.reset).toBeInViewport();
  const alert = (await save.alert.boundingBox())!;
  expect(alert.x).toBeGreaterThanOrEqual(0);
  expect(alert.x + alert.width).toBeLessThanOrEqual(320);
});
