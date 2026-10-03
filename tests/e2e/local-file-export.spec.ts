import { audioFixtureTags } from "./fixtures/catalog.ts";
import {
  audioFixture,
  captureDownload,
  expectLosslessAudio,
  inspectAudio,
  unzipDownload,
} from "./support/audio";
import { expect, test } from "./support/test";

test("edits titles of local mp3 and flac files and exports them losslessly", async ({ page }) => {
  const mp3 = audioFixture("mp3");
  const flac = audioFixture("flac");
  await page.goto("/");
  await page.locator('input[type="file"]').first().setInputFiles([mp3.upload, flac.upload]);

  const title = page.getByLabel("title", { exact: true });
  await expect(page.getByRole("heading", { level: 2 })).toContainText("Fixture Tone (mp3)");
  await title.fill("Edited mp3 title");

  const singleExport = await captureDownload(page, () =>
    page.getByRole("button", { name: "download track" }).click(),
  );
  expect(singleExport.filename).toMatch(/\.mp3$/u);
  const exportedMp3 = await inspectAudio(singleExport);
  expect(exportedMp3.metadata).toMatchObject({
    title: "Edited mp3 title",
    artist: audioFixtureTags.artist,
    album: audioFixtureTags.album,
    year: audioFixtureTags.year,
  });
  expect(exportedMp3.metadata.picture).toHaveLength(1);
  await expectLosslessAudio(singleExport, mp3.file);

  await page.getByRole("button", { name: "2 Fixture Tone (flac).flac" }).click();
  await expect(title).toHaveValue("Fixture Tone (flac)");
  await title.fill("Edited flac title");

  await page.getByRole("button", { name: "download all", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "download 2 tracks" });
  const archive = await captureDownload(page, () =>
    dialog.getByRole("button", { name: /^download ~/u }).click(),
  );
  expect(archive.filename).toMatch(/^tagium-download-.+\.zip$/u);

  const entries = unzipDownload(archive);
  expect(entries.map((entry) => entry.filename).sort()).toEqual([
    "albums/Fixture Album/Edited flac title.flac",
    "albums/Fixture Album/Edited mp3 title.mp3",
    "albums/Fixture Album/cover.jpg",
  ]);
  for (const [entry, original, editedTitle] of [
    [entries.find((file) => file.filename.endsWith(".mp3"))!, mp3.file, "Edited mp3 title"],
    [entries.find((file) => file.filename.endsWith(".flac"))!, flac.file, "Edited flac title"],
  ] as const) {
    const { metadata } = await inspectAudio(entry);
    expect(metadata).toMatchObject({ title: editedTitle, genre: audioFixtureTags.genre });
    await expectLosslessAudio(entry, original);
  }
});
