import { Buffer } from "node:buffer";
import { fixtureTitle } from "../fixtures/catalog.ts";
import { audioFixture, expectLosslessAudio, inspectAudio, unzipDownload } from "../support/audio";
import { expect, test } from "../support/test";
import {
  backToWorkspace,
  downloadAll,
  downloadTrack,
  downloadTrackButton,
  editorMode,
  field,
  formats,
  libraryCount,
  numberField,
  openSettings,
  pickFiles,
  seedSettings,
  taggedFixture,
  taggedTags,
  trackRow,
  unlinkedSettings,
  expectDownloadName,
} from "./workspace";

for (const format of formats) {
  test(`edits every field of a ${format} track and exports it losslessly`, async ({ page }) => {
    const source = taggedFixture(format);
    await seedSettings(page, unlinkedSettings);
    await page.goto("/");
    await pickFiles(page, [source.upload]);
    await expect(field(page, "title")).toHaveValue(taggedTags.title(format));

    const title = `Edited ${format} é 🦊`;
    await field(page, "title").fill(title);
    await field(page, "artist").fill("New artist 王");
    await field(page, "album").fill("New album 🌙");
    await numberField(page, "year").fill("2032");
    await field(page, "genre").fill("New genre 電子");
    await numberField(page, "track").fill("9");
    await editorMode(page, "advanced").click();
    await field(page, "album artist").fill("New album artist 🎼");
    await numberField(page, "disc number").fill("3");
    await numberField(page, "bpm").fill("127");
    await field(page, "composer").fill("Zoë Nova");
    await field(page, "comment").fill("Edited comment\nSecond line é 🦊");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(`${title}.${format}`);
    await expect(trackRow(page, `${title}.${format}`)).toBeVisible();

    const exported = await downloadTrack(page);
    expectDownloadName(exported, `${title}.${format}`);
    const { format: exportedFormat, metadata } = await inspectAudio(exported);
    expect(exportedFormat).toBe(format);
    expect(metadata).toMatchObject({
      title,
      artist: "New artist 王",
      album: "New album 🌙",
      albumArtist: "New album artist 🎼",
      year: 2032,
      genre: "New genre 電子",
      trackNumber: 9,
      trackTotal: taggedTags.trackTotal,
      discNumber: 3,
      bpm: 127,
      composer: "Zoë Nova",
      comment: "Edited comment\nSecond line é 🦊",
    });
    expect(Buffer.from(exported.bytes).includes("first line"), "stale comment alias").toBe(false);
    await expectLosslessAudio(exported, source.file);

    const repeated = await downloadTrack(page);
    expect(repeated.filename).toBe(exported.filename);
    expect(Buffer.from(repeated.bytes).equals(Buffer.from(exported.bytes))).toBe(true);
  });
}

test("exports blank advanced numbers as empty and reveals an invalid one", async ({ page }) => {
  const source = audioFixture("mp3");
  await page.goto("/");
  await pickFiles(page, [source.upload]);
  await expect(field(page, "title")).toHaveValue(fixtureTitle("mp3"));
  await downloadTrack(page);

  await openSettings(page, "editing");
  await page.getByRole("checkbox", { name: /^show advanced fields/u }).check();
  await backToWorkspace(page);
  await editorMode(page, "advanced").click();
  await expect(numberField(page, "bpm")).toHaveValue("");
  await expect(numberField(page, "disc number")).toHaveValue("");
  await field(page, "composer").fill("Late Composer");
  await editorMode(page, "normal").click();

  const blank = await downloadTrack(page);
  expect((await inspectAudio(blank)).metadata).toMatchObject({
    composer: "Late Composer",
    bpm: null,
    discNumber: null,
  });
  await expectLosslessAudio(blank, source.file);

  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await editorMode(page, "advanced").click();
  await numberField(page, "disc number").fill("0");
  await editorMode(page, "normal").click();
  await downloadTrackButton(page).click();
  await expect(editorMode(page, "advanced")).toHaveAttribute("aria-pressed", "true");
  await expect(numberField(page, "disc number")).toBeFocused();
  await expect(numberField(page, "disc number")).toHaveAccessibleDescription(
    "disc number must be a whole number from 1 to 999.",
  );
  expect(downloads).toEqual([]);

  await numberField(page, "disc number").fill("2");
  const fixed = await downloadTrack(page);
  expect((await inspectAudio(fixed)).metadata).toMatchObject({ discNumber: 2, bpm: null });
});

test("keeps filenames valid while the title changes and allows a custom filename", async ({
  page,
}) => {
  await page.goto("/");
  await pickFiles(page, [audioFixture("mp3").upload]);
  const title = field(page, "title");
  await expect(title).toHaveValue(fixtureTitle("mp3"));

  await title.fill("invalid:/name?*");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("invalid-name-.mp3");
  await expect(trackRow(page, "invalid-name-.mp3")).toBeVisible();
  const sanitized = await downloadTrack(page);
  expectDownloadName(sanitized, "invalid-name-.mp3");
  expect((await inspectAudio(sanitized)).metadata.title).toBe("invalid:/name?*");

  await title.fill("   ");
  await expect(page.getByText("filename is required", { exact: true })).toBeVisible();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await expect(downloadTrackButton(page)).toBeDisabled();

  await title.fill("Back Again");
  await expect(downloadTrackButton(page)).toBeEnabled();
  await openSettings(page, "linking");
  const syncFilename = page.getByRole("switch", { name: "sync filename with the track title" });
  await syncFilename.click();
  await expect(syncFilename).toHaveAttribute("aria-checked", "false");
  await backToWorkspace(page);

  const filename = page.getByRole("textbox", { name: "filename", exact: true });
  await filename.fill("custom: name?");
  await expect(trackRow(page, "custom- name-.mp3")).toBeVisible();
  await filename.fill("custom name");
  await expect(trackRow(page, "custom name.mp3")).toBeVisible();
  await libraryCount(page, 1);
  const custom = await downloadAll(page, "download 1 track");
  expect(custom.filename).toMatch(/^tagium-download-\d{8}-\d{6}\.zip$/u);
  expect(unzipDownload(custom).map((entry) => entry.filename)).toEqual(["singles/custom name.mp3"]);
  const single = await downloadTrack(page);
  expectDownloadName(single, "custom name.mp3");
  expect((await inspectAudio(single)).metadata.title).toBe("Back Again");
});

test("blocks download all while the active track's synced filename is blank", async ({ page }) => {
  await page.goto("/");
  await pickFiles(page, [
    audioFixture("mp3", "tone-1.mp3").upload,
    audioFixture("mp3", "tone-2.mp3").upload,
  ]);
  await libraryCount(page, 2);
  const title = field(page, "title");
  const downloadAllButton = page.getByRole("button", { name: "download all", exact: true });
  const downloadAlbum = page.getByRole("button", { name: "download Fixture Album" });
  await expect(downloadAllButton).toBeEnabled();
  await expect(downloadAlbum).toBeEnabled();

  await title.fill("   ");
  await expect(downloadTrackButton(page)).toBeDisabled();
  await expect(downloadAllButton).toBeDisabled();
  await expect(downloadAlbum).toBeDisabled();

  await trackRow(page, `2 ${fixtureTitle("mp3")}.mp3`).click();
  await expect(title).toHaveValue(fixtureTitle("mp3"));
  await expect(downloadAllButton).toBeDisabled();
  await expect(downloadAlbum).toBeDisabled();

  await trackRow(page, `1 ${fixtureTitle("mp3")}.mp3`).click();
  await title.fill("Named again");
  await expect(downloadTrackButton(page)).toBeEnabled();
  await expect(downloadAllButton).toBeEnabled();
  await expect(downloadAlbum).toBeEnabled();
});
