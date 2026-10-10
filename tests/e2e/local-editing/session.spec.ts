import { fixtureTitle } from "../fixtures/catalog.ts";
import { audioFixture } from "../support/audio";
import { expect, test } from "../support/test";
import {
  backToWorkspace,
  dropzone,
  field,
  goHome,
  libraryCount,
  openSettings,
  pickFiles,
  trackRow,
} from "./workspace";

test("warns before leaving an active session and keeps only settings after reload", async ({
  page,
}) => {
  await page.goto("/");
  await pickFiles(page, [audioFixture("opus").upload]);
  await libraryCount(page, 1);
  await page.getByRole("button", { name: "switch to dark mode" }).click();
  await openSettings(page, "editing");
  await page.getByRole("checkbox", { name: /^show advanced fields/u }).check();
  await backToWorkspace(page);
  await field(page, "title").fill("Unsaved edit");

  const dismissed = page.waitForEvent("dialog");
  const reloading = page.evaluate(() => location.reload());
  const warning = await dismissed;
  expect(warning.type()).toBe("beforeunload");
  await warning.dismiss();
  await reloading;
  await expect(field(page, "title")).toHaveValue("Unsaved edit");
  await libraryCount(page, 1);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByText("no tracks yet", { exact: true })).toBeVisible();
  await expect(dropzone(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "switch to light mode" })).toBeVisible();
  await pickFiles(page, [audioFixture("opus").upload]);
  await expect(field(page, "title")).toHaveValue(fixtureTitle("opus"));
  await expect(page.getByRole("group", { name: "metadata fields" })).toBeVisible();
});

test("home and settings keep edits, and settings ignore workspace shortcuts", async ({ page }) => {
  await page.goto("/");
  await pickFiles(page, [audioFixture("mp3").upload, audioFixture("flac").upload]);
  await libraryCount(page, 2);
  await trackRow(page, `1 ${fixtureTitle("mp3")}.mp3`).click();
  await field(page, "title").fill("Preserved edit");

  await goHome(page);
  await expect(dropzone(page)).toBeVisible();
  await expect(field(page, "title")).toBeHidden();
  await openSettings(page);
  await backToWorkspace(page);
  await expect(dropzone(page)).toBeVisible();
  await trackRow(page, "1 Preserved edit.mp3").click();
  await expect(field(page, "title")).toHaveValue("Preserved edit");

  await openSettings(page);
  await expect(page.getByRole("heading", { name: "settings" })).toBeVisible();
  await page.getByRole("button", { name: "back to workspace" }).focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await backToWorkspace(page);
  await libraryCount(page, 2);
  await expect(field(page, "title")).toHaveValue("Preserved edit");
});
