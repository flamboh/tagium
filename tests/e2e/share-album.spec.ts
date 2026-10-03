import { expect, IMPORT_TIMEOUT, test } from "./support/test";

test("shares an imported album and a visitor adds it from the share link", async ({
  page,
  upstreams,
  newContext,
}) => {
  const playlist = await upstreams.youtube.playlist({
    title: "Road Trip",
    author: "Mixer",
    videos: [{ title: "First Song", year: 2020 }, { title: "Second Song" }],
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "media url" }).fill(playlist.url);
  await page.getByRole("button", { name: "start media import" }).click();
  await expect(page.getByText("downloaded 2/2")).toBeVisible(IMPORT_TIMEOUT);
  await page.getByLabel("title", { exact: true }).fill("First Song (shared edit)");

  await page.getByRole("button", { name: "album actions for Road Trip" }).click();
  await page.getByRole("menuitem", { name: "share album" }).click();
  const dialog = page.getByRole("dialog", { name: "share album: Road Trip" });
  await expect(dialog.getByRole("list", { name: "track preview" })).toContainText(
    "First Song (shared edit)",
  );
  await dialog.getByRole("button", { name: "create share link" }).click();
  const link = dialog.getByRole("textbox", { name: "share link" });
  await expect(link).toHaveValue(/^http:\/\/127\.0\.0\.1:\d+\/share\/[A-Za-z0-9_-]+$/u);
  const shareUrl = await link.inputValue();

  const visitor = await (await newContext()).newPage();
  const response = await visitor.goto(shareUrl);
  expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  const main = visitor.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Road Trip" })).toBeVisible();
  await expect(main.getByText("shared album · 2 tracks", { exact: false })).toBeVisible();
  await expect(main.getByRole("img", { name: "Road Trip cover" })).toBeVisible();
  const tracks = main.getByRole("region", { name: "2 tracks" }).getByRole("listitem");
  await expect(tracks).toHaveText([/First Song \(shared edit\)/u, /Second Song/u]);

  await main.getByRole("button", { name: "add to library" }).click();
  await expect(visitor.getByRole("button", { name: /^Road Trip Mixer · 2 tracks/u })).toBeVisible();
  await expect(visitor.getByText("downloaded 2/2")).toBeVisible(IMPORT_TIMEOUT);
  await expect(
    visitor.getByRole("button", { name: "1 First Song (shared edit).mp3" }),
  ).toBeVisible();

  const resolves = await upstreams.calls({ route: "cobalt.resolve" });
  const byUrl = (left: string, right: string) => left.localeCompare(right);
  expect(resolves.map((call) => JSON.parse(call.requestBody!).url).sort(byUrl)).toEqual(
    [...playlist.videos, ...playlist.videos].map((video) => video.url).sort(byUrl),
  );
});
