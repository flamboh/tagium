import { fileURLToPath } from "node:url";
import { fixtureTitle } from "../fixtures/catalog.ts";
import { audioFixture, retaggedAudioFixture } from "../support/audio";
import { expect, test } from "../support/test";
import {
  dropFiles,
  dropzone,
  editorMode,
  escapeRegExp,
  field,
  formats,
  goHome,
  invalidUploads,
  libraryCount,
  numberField,
  pickFiles,
  seedSettings,
  taggedFixture,
  taggedTags,
  toast,
  trackRow,
  unlinkedSettings,
} from "./workspace";

test("reads every tag from all four formats picked together when links are off", async ({
  page,
}) => {
  await seedSettings(page, unlinkedSettings);
  await page.goto("/");
  await pickFiles(
    page,
    formats.map((format) => taggedFixture(format).upload),
  );
  await libraryCount(page, 4);
  await expect(page.getByText("Night Signals 🌙", { exact: true })).toBeVisible();

  for (const [index, format] of formats.entries()) {
    await trackRow(page, `${index + 1} ${taggedTags.title(format)}.${format}`).click();
    await editorMode(page, "normal").click();
    await expect(field(page, "title")).toHaveValue(taggedTags.title(format));
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(
      `${taggedTags.title(format)}.${format}`,
    );
    await expect(field(page, "artist")).toHaveValue(taggedTags.artist);
    await expect(field(page, "album")).toHaveValue(taggedTags.album);
    await expect(numberField(page, "year")).toHaveValue(String(taggedTags.year));
    await expect(field(page, "genre")).toHaveValue(taggedTags.genre);
    await expect(numberField(page, "track")).toHaveValue(String(taggedTags.trackNumber));
    await expect(page.getByText("no cover", { exact: true })).toBeVisible();

    await editorMode(page, "advanced").click();
    await expect(field(page, "album artist")).toHaveValue(taggedTags.albumArtist);
    await expect(numberField(page, "disc number")).toHaveValue(String(taggedTags.discNumber));
    await expect(numberField(page, "bpm")).toHaveValue("");
    await expect(field(page, "composer")).toHaveValue(taggedTags.composer);
    await expect(field(page, "comment")).toHaveValue(taggedTags.comment);
  }
});

test("drops each supported format on the landing page into one album", async ({ page }) => {
  await page.goto("/");
  const uploads = formats.map((format) => audioFixture(format).upload);

  const target = dropzone(page);
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await target.dispatchEvent("dragenter", { dataTransfer });
  await expect(target).toContainText("drop to import");
  await target.dispatchEvent("dragleave", { dataTransfer });
  await expect(target).toContainText("drop your audio here");

  await dropFiles(page, target, uploads);
  await libraryCount(page, 4);
  await expect(page.getByText("Fixture Album", { exact: true })).toBeVisible();
  await expect(page.getByText("Tagium Fixtures · 4 tracks", { exact: true })).toBeVisible();

  for (const format of formats) {
    await expect(
      page.getByRole("button", {
        name: new RegExp(`^\\d ${escapeRegExp(`${fixtureTitle(format)}.${format}`)}$`, "u"),
      }),
    ).toBeVisible();
  }

  await expect(page.getByRole("img", { name: "album cover" })).toBeVisible();
  await expect(page.getByRole("button", { name: "download track", exact: true })).toBeEnabled();
});

test("rejects unreadable files with their reasons and keeps the valid track", async ({ page }) => {
  await page.goto("/");

  await pickFiles(page, [invalidUploads.wav]);
  await expect(toast(page, "1 file could not be imported")).toContainText(
    "voice memo.wav could not be imported. wav files are not supported.",
  );
  await expect(dropzone(page)).toBeVisible();
  await expect(page.getByText("no tracks yet", { exact: true })).toBeVisible();

  const valid = audioFixture("mp3");
  await pickFiles(page, [
    invalidUploads.text,
    invalidUploads.corrupt,
    valid.upload,
    invalidUploads.empty,
  ]);
  const rejection = toast(page, "3 files could not be imported");

  for (const name of ["notes.txt", "corrupt.mp3", "empty.flac"]) {
    await expect(rejection).toContainText(
      `${name} could not be imported. try a valid mp3, flac, unencrypted m4a/mp4, or opus file.`,
    );
  }

  await libraryCount(page, 1);
  await expect(trackRow(page, `${fixtureTitle("mp3")}.mp3`)).toBeVisible();
  await expect(field(page, "title")).toHaveValue(fixtureTitle("mp3"));
  await expect(page.getByRole("button", { name: "download track", exact: true })).toBeEnabled();
});

test("skips a file that is already in the library", async ({ page }) => {
  const fixturePath = (file: string) =>
    fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url));

  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await dropzone(page).click();
  await (await chooser).setFiles(fixturePath("tone.flac"));
  await libraryCount(page, 1);

  await goHome(page);
  const again = page.waitForEvent("filechooser");
  await dropzone(page).click();
  await (await again).setFiles([fixturePath("tone.flac"), fixturePath("tone.mp3")]);
  await libraryCount(page, 2);
  await expect(trackRow(page, `${fixtureTitle("flac")}.flac`)).toHaveCount(1);
  await expect(trackRow(page, `${fixtureTitle("mp3")}.mp3`)).toBeVisible();
});

test("orders a picked album by its track numbers with untracked files last", async ({ page }) => {
  const picked = await Promise.all(
    [
      { file: "c.mp3", title: "Third", trackNumber: 3 },
      { file: "x.mp3", title: "Untracked", trackNumber: null },
      { file: "a.mp3", title: "First", trackNumber: 1 },
      { file: "b.mp3", title: "Second", trackNumber: 2 },
    ].map(({ file, title, trackNumber }) =>
      retaggedAudioFixture("mp3", file, { title, trackNumber }),
    ),
  );

  await page.goto("/");
  await pickFiles(
    page,
    picked.map(({ upload }) => upload),
  );
  await libraryCount(page, 4);
  const rows = page.getByRole("button", { name: /^\d+ \w+\.mp3$/u }).filter({ visible: true });
  await expect(rows).toHaveText([/First/u, /Second/u, /Third/u, /Untracked/u]);

  for (const [index, title] of ["First", "Second", "Third", "Untracked"].entries()) {
    await expect(trackRow(page, `${index + 1} ${title}.mp3`)).toBeVisible();
  }
});
