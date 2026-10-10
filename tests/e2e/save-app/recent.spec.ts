import { imageFixture, inspectAudio } from "../support/audio";
import { expect, IMPORT_TIMEOUT, journey, test } from "../support/test";
import { SAVE_PATH, saveApp, storedFileCount, temporarySessions } from "./save";

test("keeps the five newest saves downloadable until the page reloads", async ({
  page,
  browserName,
  upstreams,
}) => {
  journey();

  const tracks = await Promise.all(
    ["One", "Two", "Three", "Four", "Five"].map((title) =>
      upstreams.soundcloud.track({ title, author: "Loop", cover: null }),
    ),
  );

  const save = saveApp(page);
  const name = (title: string) => `${title} - Loop (soundcloud).opus`;
  const theme = page.locator("html");

  await save.open();
  const startingTheme = await theme.getAttribute("data-theme");
  await page.getByRole("button", { name: /^switch to (dark|light) mode$/u }).click();
  await expect(theme).not.toHaveAttribute("data-theme", startingTheme ?? "");
  await save.configure({ quality: "720" });

  for (const track of tracks) await save.save(track.url, name(track.title));
  await save.save(tracks[0]!.url, name("One"));

  await expect(save.rows).toHaveText(["One", "Five", "Four", "Three", "Two"].map(name));

  if (browserName !== "webkit") await expect.poll(() => storedFileCount(page)).toBe(5);
  const resolvesBefore = (await upstreams.calls({ route: "cobalt.resolve" })).length;
  expect(resolvesBefore).toBe(6);

  const five = await save.download(name("Five"));
  expect((await inspectAudio(five)).metadata).toMatchObject({ title: "Five", artist: "Loop" });
  const one = await save.download(name("One"));
  expect((await inspectAudio(one)).metadata).toMatchObject({ title: "One" });
  expect(await upstreams.calls({ route: /^cobalt\./u })).toHaveLength(12);

  await page.reload();
  await expect(save.url).toBeEditable();
  await expect(save.recent).toHaveCount(0);
  await expect(theme).not.toHaveAttribute("data-theme", startingTheme ?? "");
  await save.settings.click();
  await expect(page.getByLabel("quality", { exact: true })).toHaveValue("1080");
});

test("reclaims saved media from closed pages while open pages keep theirs", async ({
  browser,
  baseURL,
  sandbox,
  upstreams,
}, testInfo) => {
  journey();

  const first = await upstreams.soundcloud.track({
    title: "First Tab",
    author: "Loop",
    cover: null,
  });

  const second = await upstreams.soundcloud.track({
    title: "Second Tab",
    author: "Loop",
    cover: null,
  });

  const context = await browser
    .browserType()
    .launchPersistentContext(testInfo.outputPath("profile"), {
      baseURL,
    });

  try {
    await sandbox(context);
    const tabA = context.pages()[0] ?? (await context.newPage());
    const saveA = saveApp(tabA);
    await saveA.open();
    await saveA.save(first.url, "First Tab - Loop (soundcloud).opus");
    await expect.poll(async () => Object.values(await temporarySessions(tabA))).toEqual([1]);
    const [sessionA] = Object.keys(await temporarySessions(tabA));

    const tabB = await context.newPage();
    const saveB = saveApp(tabB);
    await saveB.open();
    await saveB.save(second.url, "Second Tab - Loop (soundcloud).opus");
    const sessionB = Object.keys(await temporarySessions(tabB)).find((name) => name !== sessionA);
    expect(sessionB).toBeDefined();
    await expect
      .poll(() => temporarySessions(tabB))
      .toMatchObject({ [sessionA!]: 1, [sessionB!]: 1 });

    await tabA.reload();
    await expect(saveA.url).toBeEditable();
    await expect
      .poll(async () => Object.keys(await temporarySessions(tabA)))
      .not.toContain(sessionA);
    expect(await temporarySessions(tabA)).toMatchObject({ [sessionB!]: 1 });
    const kept = await saveB.download("Second Tab - Loop (soundcloud).opus");
    expect((await inspectAudio(kept)).metadata).toMatchObject({ title: "Second Tab" });

    await tabB.close();
    const tabC = await context.newPage();
    await tabC.goto(SAVE_PATH);
    await expect
      .poll(async () => Object.keys(await temporarySessions(tabC)))
      .not.toContain(sessionB);
  } finally {
    await context.close();
  }
});

test("sweeps old root entries at startup while an open tab keeps its session", async ({
  browser,
  baseURL,
  sandbox,
  upstreams,
}, testInfo) => {
  const track = await upstreams.soundcloud.track({
    title: "Open Tab",
    author: "Loop",
    cover: null,
  });

  const context = await browser
    .browserType()
    .launchPersistentContext(testInfo.outputPath("profile"), { baseURL });

  try {
    await sandbox(context);
    const tabA = context.pages()[0] ?? (await context.newPage());
    const saveA = saveApp(tabA);
    const filename = "Open Tab - Loop (soundcloud).opus";
    await saveA.open();
    await saveA.save(track.url, filename);
    await expect.poll(async () => Object.values(await temporarySessions(tabA))).toEqual([1]);
    const [sessionA] = Object.keys(await temporarySessions(tabA));

    const tabB = await context.newPage();
    await tabB.route(`**${SAVE_PATH}`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>seed storage</title>",
      }),
    );
    await tabB.goto(SAVE_PATH);
    await tabB.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      const file = await root.getFileHandle("tagium-video-old-build", { create: true });
      const writer = await file.createWritable();
      await writer.write("old temporary media");
      await writer.close();
      const directory = await root.getDirectoryHandle("old-temporary-directory", { create: true });
      await directory.getFileHandle("leftover", { create: true });
    });

    const rootEntries = () =>
      tabB.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const names = [];

        for await (const name of root.keys()) names.push(name);

        return names.sort();
      });

    expect(await rootEntries()).toEqual([
      "old-temporary-directory",
      "tagium-save-temporary",
      "tagium-video-old-build",
    ]);

    await tabB.unroute(`**${SAVE_PATH}`);
    await tabB.reload();
    await expect(saveApp(tabB).url).toBeEditable();
    await expect.poll(rootEntries).toEqual(["tagium-save-temporary"]);
    expect(await temporarySessions(tabB)).toMatchObject({ [sessionA!]: 1 });
    expect((await inspectAudio(await saveA.download(filename))).metadata).toMatchObject({
      title: "Open Tab",
    });

    await tabB.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      await root.getFileHandle("created-after-startup", { create: true });
    });
    await saveApp(tabB).save(track.url, filename);
    expect(await rootEntries()).toEqual(["created-after-startup", "tagium-save-temporary"]);
  } finally {
    await context.close();
  }
});

test("saves files when the browser refuses private storage", async ({ page, upstreams }) => {
  await page.addInitScript(() => {
    navigator.storage.getDirectory = () =>
      Promise.reject(new DOMException("denied", "SecurityError"));
  });

  const track = await upstreams.soundcloud.track({
    title: "In Memory",
    author: "Loop",
    cover: null,
  });

  const photos = await upstreams.picker({ items: [{ type: "photo", asset: "cover" }] });
  const save = saveApp(page);

  await save.open();
  await save.save(track.url, "In Memory - Loop (soundcloud).opus");
  const audio = await save.download("In Memory - Loop (soundcloud).opus");
  expect((await inspectAudio(audio)).metadata).toMatchObject({ title: "In Memory" });

  await save.start(photos.url);
  await page.getByRole("button", { name: "download photo 1" }).click();
  await expect(save.downloadButton(`twitter_${photos.id}_1.jpg`)).toBeVisible(IMPORT_TIMEOUT);
  const photo = await save.download(`twitter_${photos.id}_1.jpg`);
  expect(photo.bytes).toEqual(imageFixture("cover").bytes);
});
