import { audioFixture } from "../support/audio";
import { expect, IMPORT_TIMEOUT, test } from "../support/test";
import { albumMenu, dragOnto, importAlbum, trackMenu, IMPORT_HEAVY } from "./helpers";

test.describe.configure(IMPORT_HEAVY);

test("local tracks and albums made from them explain why they can't be shared", async ({
  page,
}) => {
  const publications: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/manifests")) publications.push(request.url());
  });
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([audioFixture("mp3").upload]);
  const filename = "Fixture Tone (mp3).mp3";

  let menu = await trackMenu(page, filename);
  await expect(
    menu.getByRole("menuitem", { name: "share track, local tracks cannot be shared" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "add album", exact: true }).click();
  const create = page.getByRole("dialog", { name: "create album" });
  await create.getByRole("textbox", { name: "album title required" }).fill("Local Album");
  await create.getByRole("textbox", { name: "artist required" }).fill("Local Artist");
  await create.getByRole("button", { name: "create album" }).click();
  const album = page.getByRole("button", { name: "Local Album Local Artist · 0 tracks" });
  await dragOnto(page, page.getByRole("button", { name: filename, exact: true }), album);
  await expect(
    page.getByRole("button", { name: "Local Album Local Artist · 1 track" }),
  ).toBeVisible();

  menu = await albumMenu(page, "Local Album");
  await expect(
    menu.getByRole("menuitem", {
      name: "share album, only albums made entirely from imported tracks can be shared.",
    }),
  ).toBeDisabled();
  expect(publications).toEqual([]);
});

test("an imported album can be shared only once every track has finished downloading", async ({
  page,
  upstreams,
}) => {
  await importAlbum(page, upstreams, {
    title: "Slow Album",
    author: "Uploader",
    videos: [{ title: "Quick" }, { title: "Slow", cobalt: { kind: "ok", delayMs: 6_000 } }],
  });

  const menu = await albumMenu(page, "Slow Album");
  await expect(
    menu.getByRole("menuitem", {
      name: /^share album, [12] of 2 tracks (is|are) still downloading$/u,
    }),
  ).toBeDisabled();
  await expect(menu.getByRole("menuitem", { name: "share album", exact: true })).toBeEnabled(
    IMPORT_TIMEOUT,
  );
});

test("an album with a failed download explains how to make it shareable", async ({
  page,
  upstreams,
}) => {
  await importAlbum(page, upstreams, {
    title: "Mixed Album",
    author: "Uploader",
    videos: [
      { title: "Works" },
      { title: "Breaks", cobalt: { kind: "error", code: "error.api.content.video.unavailable" } },
    ],
  });
  await expect(page.getByLabel("track has an error")).toBeVisible(IMPORT_TIMEOUT);

  let menu = await albumMenu(page, "Mixed Album");
  await expect(
    menu.getByRole("menuitem", {
      name: "share album, retry or remove the failed track to share this album",
    }),
  ).toBeDisabled(IMPORT_TIMEOUT);
  await page.keyboard.press("Escape");

  menu = await trackMenu(page, "Breaks.mp3");
  await expect(
    menu.getByRole("menuitem", { name: "share track, retry this track's download to share it" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  menu = await trackMenu(page, "Works.mp3");
  await expect(menu.getByRole("menuitem", { name: "share track", exact: true })).toBeEnabled(
    IMPORT_TIMEOUT,
  );
});
