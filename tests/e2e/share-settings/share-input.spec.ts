import { expect, IMPORT_TIMEOUT, test } from "../support/test";
import {
  albumManifest,
  albumMenu,
  createShare,
  notifications,
  startImport,
  IMPORT_HEAVY,
} from "./helpers";

test.describe.configure(IMPORT_HEAVY);

test("pasted share links add the album in place, then select it instead of adding a duplicate", async ({
  page,
  request,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({ title: "Pasted Song" });
  const share = await createShare(
    request,
    albumManifest({ title: "Pasted Album", artist: "Sharer", tracks: [{ video }] }),
  );
  const albumButton = page.getByRole("button", { name: "Pasted Album Sharer · 1 track" });

  await page.goto("/");
  await startImport(page, `https://tagium.app/share/${share.slug}`);
  await expect(albumButton).toBeVisible();
  await expect(notifications(page).getByText("album added to your library")).toBeVisible();
  await expect(
    notifications(page).getByText("downloading 1 track — watch progress in the sidebar."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("button", { name: "download track" })).toBeEnabled(IMPORT_TIMEOUT);

  await page.getByRole("button", { name: "clear track selection and return to editor" }).click();
  await startImport(page, share.url);
  await expect(page.getByRole("textbox", { name: "media url" })).toHaveValue("");
  await expect(page.getByText("library (1)", { exact: true })).toBeVisible();
  await expect(albumButton).toHaveCount(1);
  expect(await upstreams.calls({ route: "cobalt.resolve" })).toHaveLength(1);

  const menu = await albumMenu(page, "Pasted Album");
  await expect(menu.getByRole("menuitem", { name: /^share album/u })).not.toBeAttached();
  await menu.getByRole("menuitem", { name: "view share link" }).click();
  const dialog = page.getByRole("dialog", { name: "share album: Pasted Album" });
  await expect(dialog.getByRole("textbox", { name: "share link" })).toHaveValue(share.url);
  await expect(dialog.getByRole("button", { name: "copy link" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "stop sharing" })).not.toBeAttached();
  await expect(dialog.getByRole("button", { name: "create share link" })).not.toBeAttached();
  await dialog.getByRole("button", { name: "done" }).click();

  await page.evaluate((url) => {
    history.pushState({}, "", url);
    dispatchEvent(new PopStateEvent("popstate"));
  }, share.url);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Pasted Album" })).toBeVisible();
  await expect(main.getByRole("button", { name: "add to library" })).not.toBeAttached();
  await main.getByRole("button", { name: "add another copy" }).click();
  await expect(albumButton).toHaveCount(2);
  await expect(page.getByText("library (2)", { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await upstreams.calls({ route: "cobalt.resolve" })).length, IMPORT_TIMEOUT)
    .toBe(2);

  await page.evaluate((url) => {
    history.pushState({}, "", url);
    dispatchEvent(new PopStateEvent("popstate"));
  }, share.url);
  await main.getByRole("button", { name: "open in tagium" }).click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(albumButton).toHaveCount(2);
  await page.getByRole("button", { name: "1 Pasted Song.mp3" }).last().click();
  await expect(page.getByRole("button", { name: "download track" })).toBeEnabled(IMPORT_TIMEOUT);
});

test("pasted tagium links that can't be shares are rejected with a reason", async ({
  page,
  baseURL,
}) => {
  await page.goto("/");
  for (const [link, reason] of [
    [`${baseURL}/share/not-valid`, "that isn’t a tagium share link"],
    [`https://tagium.app/share/abcdef?utm=1`, "that isn’t a tagium share link"],
    [`${baseURL}/share/zzzzzz`, "this share is no longer available"],
  ] as const) {
    await startImport(page, link);
    await expect(page.getByText(reason, { exact: true }), link).toBeVisible();
    await expect(page.getByRole("textbox", { name: "media url" })).toHaveValue(link);
  }
  await expect(page.getByText(/^library/u)).not.toBeAttached();
});
