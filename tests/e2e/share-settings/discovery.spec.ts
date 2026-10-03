import { FEATURE_DISCOVERY_STORAGE_KEY } from "../../../src/features/discovery/featureDiscovery";
import { audioFixture } from "../support/audio";
import { expect, IMPORT_TIMEOUT, test } from "./fixtures";
import { startImport, IMPORT_HEAVY } from "./helpers";

test.describe.configure(IMPORT_HEAVY);

test.use({ seenFeatures: [] });

const prompt = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "share your edits with a link" });

const skipAhead = async (page: import("@playwright/test").Page, milliseconds: number) => {
  await page.clock.fastForward(milliseconds);
  await page.clock.resume();
};

const discoveryFlags = (page: import("@playwright/test").Page) =>
  page.evaluate((key) => localStorage.getItem(key), FEATURE_DISCOVERY_STORAGE_KEY);

test("sharing is suggested for a ready album rather than local files, and show me opens its share action", async ({
  page,
  upstreams,
}) => {
  const playlist = await upstreams.youtube.playlist({
    title: "Spotlight Album",
    author: "Finder",
    videos: [{ title: "Lit" }, { title: "Bright" }],
  });
  const video = await upstreams.youtube.video({ title: "Loose Video" });
  await page.clock.install();
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([audioFixture("mp3").upload]);
  await expect(page.getByLabel("title", { exact: true })).toHaveValue("Fixture Tone (mp3)");
  await skipAhead(page, 5_000);
  await expect(prompt(page)).not.toBeAttached();

  await startImport(page, playlist.url);
  await expect(
    page.getByRole("button", { name: "album actions for Spotlight Album" }),
  ).toBeVisible();
  await startImport(page, video.url);
  await expect(
    page.getByRole("button", { name: "track actions for Loose Video.mp3" }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      await skipAhead(page, 2_500);
      return prompt(page).isVisible();
    }, IMPORT_TIMEOUT)
    .toBe(true);
  await expect(prompt(page)).toBeVisible();
  await expect(
    prompt(page).getByText("anyone with the link gets this album with your tags and artwork."),
  ).toBeVisible();
  expect(await discoveryFlags(page)).toBe("{}");

  await prompt(page).getByRole("button", { name: "show me" }).click();
  const menu = page.getByRole("menu", { name: "album actions for Spotlight Album" });
  await expect(menu.getByRole("menuitem", { name: "share album", exact: true })).toHaveAttribute(
    "data-spotlight",
    "active",
  );
  await menu.getByRole("menuitem", { name: "share album", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "share album: Spotlight Album" })).toBeVisible();
  expect(JSON.parse((await discoveryFlags(page))!)).toEqual({ "share-links": true });
});

test("the track suggestion is dismissed once and stays dismissed after a reload", async ({
  page,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({ title: "Solo Video" });
  await page.clock.install();
  await page.goto("/");
  await startImport(page, video.url);
  await expect(page.getByRole("button", { name: "download track" })).toBeEnabled(IMPORT_TIMEOUT);
  await skipAhead(page, 2_500);
  await expect(
    prompt(page).getByText("anyone with the link gets this track with your tags and artwork."),
  ).toBeVisible();
  await prompt(page).getByRole("button", { name: "got it" }).click();
  await expect(prompt(page)).not.toBeAttached();
  await expect(page.getByRole("menu")).not.toBeAttached();
  expect(JSON.parse((await discoveryFlags(page))!)).toEqual({ "share-links": true });

  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await startImport(page, video.url);
  await expect(page.getByRole("button", { name: "download track" })).toBeEnabled(IMPORT_TIMEOUT);
  await skipAhead(page, 5_000);
  await expect(
    page.getByRole("button", { name: "track actions for Solo Video.mp3" }),
  ).toBeVisible();
  await expect(prompt(page)).not.toBeAttached();
});
