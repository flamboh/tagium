import { audioFixture } from "../support/audio";
import { expect, IMPORT_TIMEOUT, test } from "../support/test";
import { startImport } from "../share-settings/helpers";
import { field, pickFiles } from "./workspace";

test("closing the cover popover keeps focus and typing in the field the user moved to", async ({
  page,
}) => {
  await page.goto("/");
  await pickFiles(page, [audioFixture("mp3").upload]);
  await page.addStyleTag({
    content:
      "[data-slot='popover-content'][data-state='closed'] { animation-duration: 2s !important; }",
  });
  await page.getByRole("button", { name: "crop cover art" }).click();
  await expect(page.getByRole("img", { name: "crop preview" })).toBeVisible();
  await page.getByRole("button", { name: "cancel", exact: true }).click();
  const title = field(page, "title");
  await title.fill("New title");
  await expect(page.locator("[data-slot='popover-content']")).not.toBeAttached();
  await expect(title).toBeFocused();
  await page.keyboard.type(" continued");
  await expect(title).toHaveValue("New title continued");
});

test.describe("share spotlight focus", () => {
  test.use({ seenFeatures: [] });

  test("dismissing the spotlight keeps focus and typing in the field the user moved to", async ({
    page,
    upstreams,
  }) => {
    const video = await upstreams.youtube.video({ title: "Focus single", author: "Soloist" });
    await page.clock.install();
    await page.goto("/");
    await startImport(page, video.url);
    await expect(page.getByRole("button", { name: "download track" })).toBeEnabled(IMPORT_TIMEOUT);
    await page.clock.fastForward(2_500);
    await page.clock.resume();
    const hint = page.getByRole("dialog", { name: "share your edits with a link" });
    await expect(hint).toBeVisible();
    await hint.getByRole("button", { name: "got it" }).click();
    const title = field(page, "title");
    await title.fill("New title");
    await expect(hint).not.toBeAttached();
    await expect(title).toBeFocused();
    await page.keyboard.type(" continued");
    await expect(title).toHaveValue("New title continued");
  });
});
