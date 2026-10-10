import { fixtureTitle } from "../fixtures/catalog.ts";
import { audioFixture } from "../support/audio";
import { expect, test } from "../support/test";
import { field, libraryCount, openAlbumAction, pickFiles, toast, trackRow } from "./workspace";

test("cleans up noisy titles, including the active unsaved one, and undoes it", async ({
  page,
}) => {
  await page.goto("/");
  await pickFiles(
    page,
    (["mp3", "flac", "m4a"] as const).map((format) => audioFixture(format).upload),
  );
  await libraryCount(page, 3);
  const title = field(page, "title");

  await trackRow(page, `1 ${fixtureTitle("mp3")}.mp3`).click();
  await title.fill("Night   Song (Live) (Official Audio)");
  await trackRow(page, `3 ${fixtureTitle("m4a")}.m4a`).click();
  await title.fill("TAGIUM FIXTURES - Rain – Fixture Album");
  await trackRow(page, `2 ${fixtureTitle("flac")}.flac`).click();
  await expect(title).toHaveValue(fixtureTitle("flac"));
  await title.fill("Moon [Lyrics]");

  const dialog = page.getByRole("dialog", { name: "track title clean up" });
  await openAlbumAction(page, "Fixture Album", /^clean up tracks/u);
  await expect(dialog).toContainText("review suggested title changes for Fixture Album.");

  const night = dialog.getByRole("checkbox", {
    name: /^Night\s+Song \(Live\) \(Official Audio\)\s*Night Song \(Live\)$/u,
  });

  const moon = dialog.getByRole("checkbox", { name: /^Moon \[Lyrics\]\s*Moon$/u });

  const rain = dialog.getByRole("checkbox", {
    name: /^TAGIUM FIXTURES - Rain – Fixture Album\s*Rain$/u,
  });

  await expect(night).toBeChecked();
  await expect(moon).toBeChecked();
  await expect(rain).toBeChecked();
  await expect(dialog.getByRole("button", { name: "apply 3 changes" })).toBeEnabled();

  await dialog.getByRole("button", { name: "clear all" }).click();
  await expect(night).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "apply 0 changes" })).toBeDisabled();
  await dialog.getByRole("button", { name: "close" }).click();
  await expect(dialog).toBeHidden();
  await expect(title).toHaveValue("Moon [Lyrics]");

  await openAlbumAction(page, "Fixture Album", /^clean up tracks/u);
  await expect(night).toBeChecked();
  await night.click();
  await dialog.getByRole("button", { name: "apply 2 changes" }).click();
  await expect(dialog).toBeHidden();

  const cleaned = toast(page, "cleaned up 2 tracks");
  await expect(cleaned).toContainText("titles and synced filenames were updated");
  await expect(title).toHaveValue("Moon");
  await expect(trackRow(page, "2 Moon.flac")).toBeVisible();
  await expect(trackRow(page, "3 Rain.m4a")).toBeVisible();
  await expect(trackRow(page, "1 Night Song (Live) (Official Audio).mp3")).toBeVisible();

  await cleaned.getByRole("button", { name: "undo" }).click();
  await expect(title).toHaveValue("Moon [Lyrics]");
  await expect(trackRow(page, "2 Moon [Lyrics].flac")).toBeVisible();
  await expect(trackRow(page, "3 TAGIUM FIXTURES - Rain – Fixture Album.m4a")).toBeVisible();
});
