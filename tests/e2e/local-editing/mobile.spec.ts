import type { Page } from "@playwright/test";
import { fixtureTitle } from "../fixtures/catalog.ts";
import { audioFixture, inspectAudio } from "../support/audio";
import { expect, expectDownloadName, test } from "../support/test";
import { downloadTrack, field, pickFiles, trackRow } from "./workspace";

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

  await openLibrary.click({ trial: true });
  await expect.poll(async () => (await openLibrary.boundingBox())?.x).toBe(16);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const editorLibraryBox = await openLibrary.boundingBox();
  expect(editorLibraryBox).not.toBeNull();
  await openLibrary.click();
  await drawer.getByRole("button", { name: "settings", exact: true }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { name: "settings" })).toBeVisible();
  await expect.poll(() => openLibrary.boundingBox()).toEqual(editorLibraryBox);
  await page.getByRole("button", { name: "back to workspace" }).click();
  await expect.poll(() => openLibrary.boundingBox()).toEqual(editorLibraryBox);
  await expect(title).toHaveValue(fixtureTitle("flac"));

  await openLibrary.click();
  await drawer.getByRole("button", { name: "download all", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "download 3 tracks" });
  await expect(confirmation).toBeInViewport({ ratio: 1 });
  await confirmation.getByRole("button", { name: "cancel" }).click();
  await expect(confirmation).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

const swipe = (
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerType = "touch",
) =>
  page.evaluate(
    ({ from, to, pointerType }) => {
      const target = document.elementFromPoint(from.x, from.y) ?? document.body;

      const pointer = (x: number, y: number): PointerEventInit => ({
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 7,
        pointerType,
        isPrimary: true,
        clientX: x,
        clientY: y,
        width: 24,
        height: 24,
      });

      target.dispatchEvent(new PointerEvent("pointerdown", pointer(from.x, from.y)));

      for (let step = 1; step <= 8; step += 1) {
        target.dispatchEvent(
          new PointerEvent(
            "pointermove",
            pointer(from.x + ((to.x - from.x) * step) / 8, from.y + ((to.y - from.y) * step) / 8),
          ),
        );
      }

      target.dispatchEvent(new PointerEvent("pointerup", pointer(to.x, to.y)));
    },
    { from, to, pointerType },
  );

test("swipes the library drawer open from the left edge and closed again", async ({ page }) => {
  await page.goto("/");
  await pickFiles(
    page,
    (["mp3", "flac"] as const).map((format) => audioFixture(format).upload),
  );
  const title = field(page, "title");
  await expect(title).toHaveValue(fixtureTitle("mp3"));
  const drawer = page.getByRole("dialog", { name: "library" });

  await swipe(page, { x: 300, y: 300 }, { x: 390, y: 300 });
  await swipe(page, { x: 30, y: 300 }, { x: 60, y: 460 });
  await swipe(page, { x: 30, y: 300 }, { x: 200, y: 300 }, "mouse");
  const box = (await title.boundingBox())!;
  await swipe(
    page,
    { x: box.x + 8, y: box.y + box.height / 2 },
    { x: box.x + 200, y: box.y + box.height / 2 },
  );
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(drawer).toBeHidden();

  await swipe(page, { x: 30, y: 300 }, { x: 200, y: 310 });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("library (2)", { exact: true })).toBeVisible();

  await swipe(page, { x: 300, y: 300 }, { x: 120, y: 300 });
  await expect(drawer).toBeHidden();
});

test("escape closes the library drawer and its menus one layer at a time", async ({ page }) => {
  await page.goto("/");
  await pickFiles(page, [audioFixture("mp3").upload]);
  const title = field(page, "title");
  await expect(title).toHaveValue(fixtureTitle("mp3"));

  const openLibrary = page.getByRole("button", { name: "open library" });
  const drawer = page.getByRole("dialog", { name: "library" });
  await openLibrary.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await expect(page.getByRole("dialog", { name: /^remove / })).toHaveCount(0);

  await drawer
    .getByRole("button", { name: `track actions for ${fixtureTitle("mp3")}.mp3` })
    .click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(drawer).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(openLibrary).toBeFocused();
  await expect(title).toHaveValue(fixtureTitle("mp3"));
});
