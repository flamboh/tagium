import { fixtureTitle } from "../fixtures/catalog.ts";
import { audioFixture } from "../support/audio";
import { expect, test } from "../support/test";
import { field, formats, libraryCount, pickFiles, trackRow } from "./workspace";

test("selects ranges, toggles tracks, selects all and deletes the selection", async ({ page }) => {
  await page.goto("/");
  await pickFiles(
    page,
    formats.map((format) => audioFixture(format).upload),
  );
  await libraryCount(page, 4);
  const row = (position: number) =>
    trackRow(page, `${position} ${fixtureTitle(formats[position - 1]!)}.${formats[position - 1]}`);
  const title = field(page, "title");
  const removeTracks = (count: number) =>
    page.getByRole("dialog", { name: `remove ${count} tracks?` });

  await expect(title).toBeFocused();
  await row(3).click({ modifiers: ["Shift"] });
  await expect(title).not.toBeFocused();
  await page.keyboard.press("Delete");
  await expect(removeTracks(3)).toContainText(
    "this removes the tracks from the current session. this cannot be undone.",
  );
  await removeTracks(3).getByRole("button", { name: "keep tracks" }).click();
  await expect(removeTracks(3)).toBeHidden();
  await libraryCount(page, 4);

  await row(1).click();
  await row(3).click({ modifiers: ["ControlOrMeta"] });
  await title.fill("Only the active track");
  await expect(trackRow(page, "3 Only the active track.m4a")).toBeVisible();
  await expect(row(1)).toBeVisible();

  await row(2).click();
  await expect(title).toBeFocused();
  await title.press("ControlOrMeta+a");
  await title.press("Delete");
  await expect(title).toHaveValue("");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await title.fill(fixtureTitle("flac"));

  await page.getByText("library (4)", { exact: true }).click();
  await expect(title).not.toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await expect(title).not.toBeFocused();
  await page.keyboard.press("Delete");
  await removeTracks(4).getByRole("button", { name: "remove tracks" }).click();
  await libraryCount(page, 0);
  await expect(page.getByText("drag tracks here", { exact: true })).toBeVisible();
});

test("dialogs and menus keep workspace shortcuts from acting on the library", async ({ page }) => {
  await page.goto("/");
  await pickFiles(page, [audioFixture("mp3").upload]);
  await libraryCount(page, 1);
  const title = field(page, "title");
  await expect(title).toHaveValue(fixtureTitle("mp3"));

  await page.getByRole("button", { name: "download all", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "download 1 track" });
  await expect(dialog.getByRole("button", { name: "cancel" })).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect(page.getByRole("dialog", { name: /^remove / })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(title).toHaveValue(fixtureTitle("mp3"));

  await page.getByRole("button", { name: `track actions for ${fixtureTitle("mp3")}.mp3` }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("dialog", { name: /^remove / })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(title).toHaveValue(fixtureTitle("mp3"));
  await libraryCount(page, 1);
});
