import { Buffer } from "node:buffer";
import type { Locator, Page } from "@playwright/test";
import { fixtureTitle, type AudioFixtureFormat } from "../fixtures/catalog.ts";
import {
  audioFixture,
  expectLosslessAudio,
  imageFixture,
  inspectAudio,
  unzipDownload,
} from "../support/audio";
import { expect, test } from "../support/test";
import {
  downloadAll,
  downloadTrack,
  field,
  formats,
  goHome,
  libraryCount,
  numberField,
  openAlbumAction,
  pickFiles,
  trackRow,
} from "./workspace";

const row = (page: Page, position: number, format: AudioFixtureFormat) =>
  trackRow(page, `${position} ${fixtureTitle(format)}.${format}`);

const albumHeaders = (page: Page) => page.getByRole("button", { name: /^album actions for / });

const drag = async (page: Page, source: Locator, target: Locator, offsetY = 0) => {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + offsetY, { steps: 12 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + offsetY + 1, { steps: 2 });
  await page.mouse.up();
};

test("applies album edits and a new cover to every format it exports", async ({ page }) => {
  const sources = formats.map((format) => audioFixture(format));
  const artwork = imageFixture("artwork");
  await page.goto("/");
  await pickFiles(
    page,
    sources.map((source) => source.upload),
  );
  await libraryCount(page, 4);

  await openAlbumAction(page, "Fixture Album", "edit album");
  const dialog = page.getByRole("dialog", { name: "edit album" });
  await dialog.getByRole("textbox", { name: /^album title/u }).fill("Edited Album 🌟");
  await dialog.getByRole("textbox", { name: /^artist/u }).fill("Album Artist 王");
  await dialog.getByRole("textbox", { name: "genre", exact: true }).fill("Experimental");
  await dialog.getByRole("spinbutton", { name: "year", exact: true }).fill("2030");
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "upload cover" }).click();
  await (await chooser).setFiles(artwork.upload);
  await expect(dialog.getByRole("button", { name: "save album" })).toBeEnabled();
  await dialog.getByRole("button", { name: "save album" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Album Artist 王 · 4 tracks", { exact: true })).toBeVisible();

  await row(page, 3, "m4a").click();
  await expect(field(page, "artist")).toBeDisabled();
  await expect(field(page, "artist")).toHaveValue("Album Artist 王");
  await expect(field(page, "album")).toHaveValue("Edited Album 🌟");
  await expect(numberField(page, "year")).toHaveValue("2030");
  await expect(field(page, "genre")).toHaveValue("Experimental");
  await expect(numberField(page, "track")).toHaveValue("3");
  await expect(page.getByRole("button", { name: "cover linked" })).toBeDisabled();

  const archive = await downloadAll(page, "download 4 tracks");
  const entries = unzipDownload(archive);
  expect(entries.map((entry) => entry.filename).sort()).toEqual(
    [
      "albums/Edited Album 🌟/cover.png",
      ...formats.map((format) => `albums/Edited Album 🌟/${fixtureTitle(format)}.${format}`),
    ].sort(),
  );
  expect(
    Buffer.from(entries.find((entry) => entry.filename.endsWith("cover.png"))!.bytes).equals(
      Buffer.from(artwork.bytes),
    ),
  ).toBe(true);
  for (const [index, format] of formats.entries()) {
    const entry = entries.find((file) => file.filename.endsWith(`.${format}`))!;
    const { metadata } = await inspectAudio(entry);
    expect(metadata).toMatchObject({
      title: fixtureTitle(format),
      album: "Edited Album 🌟",
      artist: "Album Artist 王",
      albumArtist: "Album Artist 王",
      year: 2030,
      genre: "Experimental",
      trackNumber: index + 1,
    });
    expect(metadata.picture).toHaveLength(1);
    expect(metadata.picture[0]!.format).toBe("image/png");
    expect(Buffer.from(metadata.picture[0]!.data).equals(Buffer.from(artwork.bytes))).toBe(true);
    await expectLosslessAudio(entry, sources[index]!.file);
  }
});

test("creates, keeps and deletes an empty album", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("no tracks yet", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "add album" }).click();
  const create = page.getByRole("dialog", { name: "create album" });
  const albumTitle = create.getByRole("textbox", { name: /^album title/u });
  await albumTitle.focus();
  await albumTitle.blur();
  await expect(create.getByText("album title is required")).toBeVisible();
  await expect(create.getByRole("button", { name: "create album" })).toBeDisabled();
  await create.getByRole("button", { name: "cancel" }).click();
  await expect(create).toBeHidden();
  await expect(page.getByText("no tracks yet", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "add album" }).click();
  await albumTitle.fill("Empty Album");
  await create.getByRole("textbox", { name: /^artist/u }).fill("Someone");
  await create.getByRole("button", { name: "create album" }).click();
  await expect(create).toBeHidden();
  await expect(page.getByText("Someone · 0 tracks", { exact: true })).toBeVisible();
  await expect(page.getByText("drag tracks here", { exact: true })).toBeVisible();

  const deleteEmpty = page.getByRole("dialog", { name: "delete Empty Album?" });
  await openAlbumAction(page, "Empty Album", "delete album");
  await expect(deleteEmpty).toContainText(
    "this deletes the album from the current session. this cannot be undone.",
  );
  await deleteEmpty.getByRole("button", { name: "keep album" }).click();
  await expect(deleteEmpty).toBeHidden();
  await expect(page.getByText("Someone · 0 tracks", { exact: true })).toBeVisible();
  await openAlbumAction(page, "Empty Album", "delete album");
  await deleteEmpty.getByRole("button", { name: "delete album" }).click();
  await expect(page.getByText("no tracks yet", { exact: true })).toBeVisible();
});

test("removes a track and deletes a full album only after confirmation", async ({ page }) => {
  await page.goto("/");
  await pickFiles(
    page,
    (["mp3", "flac", "m4a"] as const).map((format) => audioFixture(format).upload),
  );
  await libraryCount(page, 3);
  const removeTrack = page.getByRole("dialog", { name: "remove track?" });
  const flacActions = page.getByRole("button", {
    name: `track actions for ${fixtureTitle("flac")}.flac`,
  });
  await flacActions.click();
  await page.getByRole("menuitem", { name: "remove track" }).click();
  await expect(removeTrack).toContainText(
    "this removes the track from the current session. this cannot be undone.",
  );
  await removeTrack.getByRole("button", { name: "keep track" }).click();
  await expect(removeTrack).toBeHidden();
  await libraryCount(page, 3);
  await flacActions.click();
  await page.getByRole("menuitem", { name: "remove track" }).click();
  await removeTrack.getByRole("button", { name: "remove track" }).click();
  await libraryCount(page, 2);
  await expect(row(page, 1, "mp3")).toBeVisible();
  await expect(row(page, 2, "m4a")).toBeVisible();

  const deleteAlbum = page.getByRole("dialog", { name: "delete Fixture Album?" });
  await openAlbumAction(page, "Fixture Album", "delete album");
  await expect(deleteAlbum).toContainText(
    "this deletes the album and all 2 tracks from the current session. this cannot be undone.",
  );
  await deleteAlbum.getByRole("button", { name: "delete album" }).click();
  await expect(page.getByText("no tracks yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "download all", exact: true })).toBeDisabled();
});

test("drags a track to a new position in its album", async ({ page }) => {
  await page.goto("/");
  await pickFiles(
    page,
    (["mp3", "flac", "m4a"] as const).map((format) => audioFixture(format).upload),
  );
  await libraryCount(page, 3);

  await drag(page, row(page, 1, "mp3"), row(page, 3, "m4a"), 8);
  await expect(row(page, 1, "flac")).toBeVisible();
  await expect(row(page, 2, "m4a")).toBeVisible();
  await expect(row(page, 3, "mp3")).toBeVisible();
  await row(page, 3, "mp3").click();
  await expect(numberField(page, "track")).toHaveValue("3");
});

test("drags a track into another album and that album above the first", async ({ page }) => {
  const mp3 = audioFixture("mp3");
  await page.goto("/");
  await pickFiles(page, [mp3.upload, audioFixture("flac").upload]);
  await libraryCount(page, 2);

  await page.getByRole("button", { name: "add album" }).click();
  const create = page.getByRole("dialog", { name: "create album" });
  await create.getByRole("textbox", { name: /^album title/u }).fill("Second Album");
  await create.getByRole("textbox", { name: /^artist/u }).fill("Second Artist");
  await create.getByRole("button", { name: "create album" }).click();
  await expect(create).toBeHidden();

  await drag(page, row(page, 1, "mp3"), page.getByText("drag tracks here", { exact: true }));
  await expect(page.getByText("Second Artist · 1 track", { exact: true })).toBeVisible();
  await expect(page.getByText("Tagium Fixtures · 1 track", { exact: true })).toBeVisible();
  await row(page, 1, "mp3").click();
  await expect(field(page, "artist")).toHaveValue("Second Artist");
  await expect(field(page, "album")).toHaveValue("Second Album");
  await expect(numberField(page, "track")).toHaveValue("1");

  await expect(albumHeaders(page).first()).toHaveAccessibleName("album actions for Fixture Album");
  await drag(
    page,
    page.getByText("Second Artist · 1 track", { exact: true }),
    page.getByText("Tagium Fixtures · 1 track", { exact: true }),
    -12,
  );
  await expect(albumHeaders(page).first()).toHaveAccessibleName("album actions for Second Album");
  await expect(albumHeaders(page).last()).toHaveAccessibleName("album actions for Fixture Album");

  const moved = await downloadTrack(page);
  expect((await inspectAudio(moved)).metadata).toMatchObject({
    title: fixtureTitle("mp3"),
    artist: "Second Artist",
    album: "Second Album",
    trackNumber: 1,
  });
  await expectLosslessAudio(moved, mp3.file);
});

test("drops one loose track on another to group them into a new album", async ({ page }) => {
  await page.goto("/");
  await pickFiles(page, [audioFixture("mp3").upload]);
  await libraryCount(page, 1);
  await expect(field(page, "album")).toHaveValue(fixtureTitle("mp3"));
  await goHome(page);
  await pickFiles(page, [audioFixture("opus").upload]);
  await libraryCount(page, 2);

  await drag(
    page,
    trackRow(page, `${fixtureTitle("mp3")}.mp3`),
    trackRow(page, `${fixtureTitle("opus")}.opus`),
  );
  const create = page.getByRole("dialog", { name: "create album" });
  await create.getByRole("textbox", { name: /^album title/u }).fill("Paired Album");
  await create.getByRole("textbox", { name: /^artist/u }).fill("Pair Artist");
  await create.getByRole("button", { name: "create album" }).click();
  await expect(create).toBeHidden();
  await expect(page.getByText("Pair Artist · 2 tracks", { exact: true })).toBeVisible();

  await trackRow(page, `1 ${fixtureTitle("mp3")}.mp3`).click();
  await expect(field(page, "album")).toHaveValue("Paired Album");
  await expect(field(page, "artist")).toHaveValue("Pair Artist");
  const exported = await downloadTrack(page);
  expect((await inspectAudio(exported)).metadata).toMatchObject({
    album: "Paired Album",
    artist: "Pair Artist",
    trackNumber: 1,
  });
});
