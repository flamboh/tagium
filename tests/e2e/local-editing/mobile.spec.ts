import { fixtureTitle } from "../fixtures/catalog.ts";
import { audioFixture, inspectAudio } from "../support/audio";
import { expect, test } from "../support/test";
import { downloadTrack, field, pickFiles, trackRow, expectDownloadName } from "./workspace";

test.use({ viewport: { width: 390, height: 844 } });

test("edits, navigates and exports from the library drawer on a phone", async ({ page }) => {
  await page.goto("/");
  await pickFiles(
    page,
    (["mp3", "flac", "m4a"] as const).map((format) => audioFixture(format).upload),
  );
  const title = field(page, "title");
  await expect(title).toHaveValue(fixtureTitle("mp3"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await title.fill("Phone edit");
  const exported = await downloadTrack(page);
  expectDownloadName(exported, "Phone edit.mp3");
  expect((await inspectAudio(exported)).metadata.title).toBe("Phone edit");

  const openLibrary = page.getByRole("button", { name: "open library" });
  const drawer = page.getByRole("dialog", { name: "library" });
  await openLibrary.click();
  await expect(drawer.getByText("library (3)", { exact: true })).toBeVisible();
  await trackRow(page, `2 ${fixtureTitle("flac")}.flac`).click();
  await expect(drawer).toBeHidden();
  await expect(title).toHaveValue(fixtureTitle("flac"));

  await openLibrary.click();
  await drawer.getByRole("button", { name: "close library" }).click();
  await expect(drawer).toBeHidden();
  await expect(title).toHaveValue(fixtureTitle("flac"));

  await openLibrary.click();
  await drawer.getByRole("button", { name: "settings", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { name: "settings" })).toBeVisible();
  await page.getByRole("button", { name: "back to workspace" }).click();
  await expect(title).toHaveValue(fixtureTitle("flac"));

  await openLibrary.click();
  await drawer.getByRole("button", { name: "download all", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "download 3 tracks" });
  await expect(confirmation).toBeInViewport({ ratio: 1 });
  await confirmation.getByRole("button", { name: "cancel" }).click();
  await expect(confirmation).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
