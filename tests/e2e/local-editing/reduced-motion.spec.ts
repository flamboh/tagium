import type { Locator } from "@playwright/test";
import { fixtureTitle } from "../fixtures/catalog.ts";
import { audioFixture } from "../support/audio";
import { expect, test } from "../support/test";
import { libraryCount, pickFiles } from "./workspace";

const motion = (locator: Locator) =>
  locator.evaluate((element) => ({
    animationName: getComputedStyle(element).animationName,
    running: element.getAnimations().length,
  }));

test("dialogs and menus open without animation when reduced motion is requested", async ({
  page,
}) => {
  await page.goto("/");
  await pickFiles(page, [audioFixture("mp3").upload]);
  await libraryCount(page, 1);
  const downloadAll = page.getByRole("button", { name: "download all", exact: true });
  const dialog = page.getByRole("dialog", { name: "download 1 track" });
  const overlay = page.locator("[data-slot='dialog-overlay']");

  const menuButton = page.getByRole("button", {
    name: `track actions for ${fixtureTitle("mp3")}.mp3`,
  });

  const menu = page.getByRole("menu");

  await downloadAll.click();
  expect((await motion(dialog)).animationName).toBe("enter");
  await dialog.getByRole("button", { name: "cancel" }).click();
  await expect(dialog).toBeHidden();

  await page.emulateMedia({ reducedMotion: "reduce" });
  await downloadAll.click();
  await expect(dialog).toBeVisible();
  expect(await motion(dialog)).toEqual({ animationName: "none", running: 0 });
  expect(await motion(overlay)).toEqual({ animationName: "none", running: 0 });
  await dialog.getByRole("button", { name: "cancel" }).click();
  await expect(dialog).toHaveCount(0);

  await menuButton.click();
  await expect(menu).toBeVisible();
  expect(await motion(menu)).toEqual({ animationName: "none", running: 0 });
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
});
