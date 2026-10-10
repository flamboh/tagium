import { audioFixtureTags, fixtureTitle } from "../fixtures/catalog.ts";
import {
  audioFixture,
  expectLosslessAudio,
  inspectAudio,
  unzipDownload,
  retaggedAudioFixture,
} from "../support/audio";
import { expect, expectDownloadName, test } from "../support/test";
import {
  confirmDownload,
  downloadTrack,
  field,
  editorMode,
  seedSettings,
  goHome,
  libraryCount,
  pickFiles,
  trackRow,
} from "./workspace";

test("exports a loose track and an album on the first confirmation with unique names", async ({
  page,
}) => {
  const tone = audioFixture("mp3");
  await page.goto("/");
  await pickFiles(page, [tone.upload]);
  await libraryCount(page, 1);
  await goHome(page);
  await pickFiles(page, [
    audioFixture("mp3", "tone-2.mp3").upload,
    audioFixture("mp3", "tone-3.mp3").upload,
  ]);
  await libraryCount(page, 3);
  await expect(trackRow(page, `1 ${fixtureTitle("mp3")}.mp3`)).toBeVisible();
  await expect(trackRow(page, `2 ${fixtureTitle("mp3")}.mp3`)).toBeVisible();

  await page.getByRole("button", { name: "download all", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "download 3 tracks" });
  await expect(dialog.getByRole("button", { name: "singles 1 track" })).toBeVisible();
  const albumGroup = dialog.getByRole("button", { name: "Fixture Album 2 tracks" });
  await albumGroup.click();
  await expect(albumGroup).toHaveAttribute("aria-expanded", "true");
  await expect(dialog.getByRole("region", { name: "Fixture Album tracks" })).toHaveText(
    `${fixtureTitle("mp3")}${fixtureTitle("mp3")}`,
  );
  const archive = await confirmDownload(page, "download 3 tracks");
  expect(archive.filename).toMatch(/^tagium-download-\d{8}-\d{6}\.zip$/u);
  await expect(dialog).toBeHidden();

  const entries = unzipDownload(archive);
  expect(entries.map((entry) => entry.filename).sort()).toEqual([
    `albums/Fixture Album/${fixtureTitle("mp3")}-2.mp3`,
    `albums/Fixture Album/${fixtureTitle("mp3")}.mp3`,
    "albums/Fixture Album/cover.jpg",
    `singles/${fixtureTitle("mp3")}.mp3`,
  ]);
  for (const entry of entries.filter((file) => file.filename.endsWith(".mp3"))) {
    expect((await inspectAudio(entry)).metadata).toMatchObject({
      title: fixtureTitle("mp3"),
      artist: audioFixtureTags.artist,
    });
    await expectLosslessAudio(entry, tone.file);
  }
  const single = entries.find((entry) => entry.filename.startsWith("singles/"))!;
  expect((await inspectAudio(single)).metadata.albumArtist).toBe(audioFixtureTags.albumArtist);

  await page.getByRole("button", { name: "download Fixture Album" }).click();
  const albumArchive = await confirmDownload(page, "download 2 tracks");
  expectDownloadName(albumArchive, "Fixture Album.zip");
  expect(
    unzipDownload(albumArchive)
      .map((entry) => entry.filename)
      .sort(),
  ).toEqual([
    `Fixture Album/${fixtureTitle("mp3")}-2.mp3`,
    `Fixture Album/${fixtureTitle("mp3")}.mp3`,
    "Fixture Album/cover.jpg",
  ]);
});

test("export confirmation takes focus and cancels without downloading", async ({ page }) => {
  await page.goto("/");
  await pickFiles(page, [audioFixture("flac").upload]);
  await libraryCount(page, 1);
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));

  const trigger = page.getByRole("button", { name: "download all", exact: true });
  const dialog = page.getByRole("dialog", { name: "download 1 track" });
  await trigger.click();
  await expect(dialog.getByRole("button", { name: "cancel" })).toBeFocused();
  await expect(dialog.getByRole("button", { name: /^download ~0\.\d\d mb$/u })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByRole("button", { name: "cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(downloads).toEqual([]);
});

for (const existingAlbumArtist of ["Various Artists", ""]) {
  test(`the default album artist link preserves ${existingAlbumArtist || "a blank value until filled"} when editing and exporting a single`, async ({
    page,
  }) => {
    await seedSettings(page, { advancedMetadata: true });
    const source = await retaggedAudioFixture("mp3", "single.mp3", {
      albumArtist: existingAlbumArtist,
    });
    await page.goto("/");
    await pickFiles(page, [source.upload]);
    await expect(field(page, "title")).toHaveValue(fixtureTitle("mp3"));
    const expectedAlbumArtist = existingAlbumArtist || audioFixtureTags.artist;
    await field(page, "title").fill("Edited single");
    const exported = await downloadTrack(page);
    expect((await inspectAudio(exported)).metadata).toMatchObject({
      title: "Edited single",
      albumArtist: expectedAlbumArtist,
    });
    await page.getByRole("button", { name: "download all", exact: true }).click();
    const archive = await confirmDownload(page, "download 1 track");
    const single = unzipDownload(archive).find((entry) => entry.filename.endsWith(".mp3"))!;
    expect((await inspectAudio(single)).metadata.albumArtist).toBe(expectedAlbumArtist);
    await editorMode(page, "advanced").click();
    await expect(field(page, "album artist")).toHaveValue(expectedAlbumArtist);
    await expectLosslessAudio(single, source.file);
  });
}
