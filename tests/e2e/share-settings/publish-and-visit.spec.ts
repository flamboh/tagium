import { captureDownload, inspectAudio, unzipDownload } from "../support/audio";
import { expect, IMPORT_TIMEOUT, JOURNEY_TIMEOUT, test } from "./fixtures";
import {
  albumMenu,
  createShare,
  importAlbum,
  notifications,
  openShareDialog,
  publishAlbum,
  seedSettings,
  SHARE_URL,
  slugOf,
  startImport,
  storedReceipts,
  trackMenu,
  savedName,
} from "./helpers";

test.describe.configure({ timeout: JOURNEY_TIMEOUT });

const dialogExpiry = (expiresAt: string) =>
  new Date(expiresAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const pageExpiry = (expiresAt: string) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
    .format(new Date(expiresAt))
    .toLowerCase();

test("a fresh visitor adds a published album and exports it with the shared tags, bitrate and cover", async ({
  page,
  context,
  upstreams,
  newContext,
}) => {
  await seedSettings(context, { audioBitrate: "64" });
  const playlist = await importAlbum(page, upstreams, {
    title: "Road Trip",
    author: "Mixer",
    videos: [{ title: "First Song", year: 2020 }, { title: "Second Song" }],
  });
  await page.getByLabel("title", { exact: true }).fill("First Song (shared edit)");

  const dialog = await openShareDialog(page, "Road Trip");
  await expect(
    dialog.getByRole("list", { name: "track preview" }).getByRole("listitem"),
  ).toHaveText([/First Song \(shared edit\)/u, /Second Song/u]);
  await expect(dialog.getByLabel("album cover", { exact: true })).toBeVisible();
  await expect(
    dialog.getByText(
      "anyone with the link can add this album. tracks are added from their original sources with these shared tags.",
    ),
  ).toBeVisible();
  await expect(dialog.getByText("expires in 90 days.")).toBeVisible();

  const publication = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/manifests") && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "create share link" }).click();
  const receipt = (await (await publication).json()) as { slug: string; expiresAt: string };
  const link = dialog.getByRole("textbox", { name: "share link" });
  await expect(link).toHaveValue(SHARE_URL);
  const shareUrl = await link.inputValue();
  expect(slugOf(shareUrl)).toBe(receipt.slug);
  await expect(
    dialog.getByText(
      `expires ${dialogExpiry(receipt.expiresAt)} · stop sharing to turn the link off at any time`,
    ),
  ).toBeVisible();
  expect(await storedReceipts(page)).toEqual([
    expect.objectContaining({ slug: receipt.slug, expiresAt: receipt.expiresAt }),
  ]);
  await dialog.getByRole("button", { name: "done" }).click();
  await expect(dialog).not.toBeAttached();

  const visitor = await (await newContext()).newPage();
  await visitor.goto(shareUrl);
  const main = visitor.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Road Trip" })).toBeVisible();
  await expect(
    main.getByText(`shared album · 2 tracks · link expires ${pageExpiry(receipt.expiresAt)}`),
  ).toBeVisible();
  await expect(main.getByText("Mixer", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("link", { name: "from youtube.com (opens in a new tab)" }),
  ).toHaveAttribute("href", playlist.url);
  const cover = main.getByRole("img", { name: "Road Trip cover" });
  await expect(cover).toBeVisible();
  await expect
    .poll(() => cover.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await expect(
    main.getByText("adding downloads each track from its original source with the shared tags."),
  ).toBeVisible();
  await expect(main.getByRole("region", { name: "2 tracks" }).getByRole("listitem")).toHaveText([
    /1\s*First Song \(shared edit\)/u,
    /2\s*Second Song/u,
  ]);
  await expect(visitor.getByRole("button", { name: "stop sharing" })).not.toBeAttached();

  await main.getByRole("button", { name: "add to library" }).click();
  await expect(notifications(visitor).getByText("album added to your library")).toBeVisible();
  await expect(
    notifications(visitor).getByText("downloading 2 tracks — watch progress in the sidebar."),
  ).toBeVisible();
  await expect(visitor).toHaveURL(/\/$/u);
  await expect(visitor.getByRole("button", { name: "Road Trip Mixer · 2 tracks" })).toBeVisible();
  await expect(visitor.getByText("downloaded 2/2")).toBeVisible(IMPORT_TIMEOUT);

  await visitor.getByRole("button", { name: "download all", exact: true }).click();
  const archive = await captureDownload(visitor, () =>
    visitor
      .getByRole("dialog", { name: "download 2 tracks" })
      .getByRole("button", { name: /^download ~/u })
      .click(),
  );
  const tracks = unzipDownload(archive).filter((entry) => entry.filename.endsWith(".mp3"));
  expect(tracks.map((entry) => entry.filename).sort()).toEqual([
    "albums/Road Trip/First Song (shared edit).mp3",
    "albums/Road Trip/Second Song.mp3",
  ]);
  const artwork = new Uint8Array(
    await (await visitor.request.get(`/api/manifests/${receipt.slug}/artwork`)).body(),
  );
  for (const [index, title] of ["First Song (shared edit)", "Second Song"].entries()) {
    const { format, metadata } = await inspectAudio(
      tracks.find((entry) => entry.filename.endsWith(`${title}.mp3`))!,
    );
    expect(format).toBe("mp3");
    expect(metadata).toMatchObject({
      title,
      artist: "Mixer",
      album: "Road Trip",
      trackNumber: index + 1,
    });
    expect(metadata.duration).toBeCloseTo(2, 0);
    expect(metadata.picture).toHaveLength(1);
    expect(new Uint8Array(metadata.picture![0]!.data)).toEqual(artwork);
  }

  const resolves = await upstreams.calls({ route: "cobalt.resolve" });
  expect(resolves).toHaveLength(4);
  for (const call of resolves) {
    expect(JSON.parse(call.requestBody!)).toMatchObject({ audioBitrate: "64", audioFormat: "mp3" });
  }
});

test("the creator views, updates and stops an album share, then shares it again under a new link", async ({
  page,
  upstreams,
  newContext,
}) => {
  await importAlbum(page, upstreams, {
    title: "Night Set",
    author: "Selector",
    videos: [{ title: "Opener" }],
  });
  const { dialog, url } = await publishAlbum(page, "Night Set");
  await dialog.getByRole("button", { name: "done" }).click();

  let menu = await albumMenu(page, "Night Set");
  await menu.getByRole("menuitem", { name: "view share link" }).click();
  await expect(dialog.getByRole("textbox", { name: "share link" })).toHaveValue(url);
  await dialog.getByRole("button", { name: "done" }).click();

  await page.getByLabel("title", { exact: true }).fill("Opener (edit)");
  menu = await albumMenu(page, "Night Set");
  await menu.getByRole("menuitem", { name: "update shared album" }).click(IMPORT_TIMEOUT);
  await expect(dialog.getByRole("list", { name: "track preview" })).toHaveText(/Opener \(edit\)/u);
  await expect(dialog.getByText("the link keeps its current expiration.")).toBeVisible();
  const update = page.waitForRequest((request) => request.method() === "PATCH");
  await dialog.getByRole("button", { name: "update shared album" }).click();
  expect((await update).url()).toBe(new URL(`/api/manifests/${slugOf(url)}`, url).href);
  await expect(dialog.getByRole("textbox", { name: "share link" })).toHaveValue(url);
  await dialog.getByRole("button", { name: "done" }).click();

  const visitor = await (await newContext()).newPage();
  await visitor.goto(url);
  await expect(visitor.getByRole("main").getByRole("listitem")).toHaveText([/Opener \(edit\)/u]);

  menu = await albumMenu(page, "Night Set");
  await menu.getByRole("menuitem", { name: "view share link" }).click(IMPORT_TIMEOUT);
  await dialog.getByRole("button", { name: "stop sharing" }).click();
  await expect(dialog.getByText("the link will stop working immediately.")).toBeVisible();
  await dialog.getByRole("button", { name: "keep sharing" }).click();
  await expect(dialog.getByText(/stop sharing to turn the link off at any time/u)).toBeVisible();
  await dialog.getByRole("button", { name: "stop sharing" }).click();
  await dialog.getByRole("button", { name: "stop sharing" }).click();
  await expect(dialog).not.toBeAttached();
  await expect(notifications(page).getByText("sharing stopped")).toBeVisible();
  await expect(notifications(page).getByText("the link no longer works.")).toBeVisible();
  expect(await storedReceipts(page)).toEqual([]);

  await visitor.reload();
  await expect(
    visitor.getByRole("heading", { level: 1, name: "this share is no longer available" }),
  ).toBeVisible();

  const { url: newUrl } = await publishAlbum(page, "Night Set");
  expect(newUrl).not.toBe(url);
  await visitor.goto(newUrl);
  await expect(visitor.getByRole("heading", { level: 1, name: "Night Set" })).toBeVisible();
});

test("a single imported track is shared on its own, and a share without artwork stays without it", async ({
  page,
  request,
  upstreams,
  newContext,
}) => {
  const video = await upstreams.youtube.video({ title: "Single", author: "Soloist" });
  await page.goto("/");
  await startImport(page, video.url);
  await expect(page.getByRole("button", { name: "download track" })).toBeEnabled(IMPORT_TIMEOUT);

  const title = page.getByLabel("title", { exact: true });
  await title.fill("x".repeat(1_025));
  let menu = await trackMenu(page, /^track actions for x+/u);
  await menu.getByRole("menuitem", { name: "share track", exact: true }).click();
  await expect(notifications(page).getByText("this track cannot be shared")).toBeVisible();
  await expect(
    notifications(page).getByText("this track contains too much metadata to share."),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).not.toBeAttached();

  await expect(async () => {
    await title.fill("Single (shared)");
    await expect(
      page.getByRole("button", { name: "track actions for Single (shared).mp3" }),
    ).toBeVisible({ timeout: 5_000 });
  }).toPass();
  menu = await trackMenu(page, "Single (shared).mp3");
  await menu.getByRole("menuitem", { name: "share track", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "share track: Single (shared)" });
  await expect(
    dialog.getByText(
      "anyone with the link can add this track. it is downloaded from its original source with these shared tags.",
    ),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "create share link" }).click();
  const link = dialog.getByRole("textbox", { name: "share link" });
  await expect(link).toHaveValue(SHARE_URL);
  const shareUrl = await link.inputValue();
  await dialog.getByRole("button", { name: "done" }).click();
  menu = await trackMenu(page, "Single (shared).mp3");
  await expect(menu.getByRole("menuitem", { name: "view share link" })).toBeEnabled();
  await page.keyboard.press("Escape");

  const visitor = await (await newContext()).newPage();
  await visitor.goto(shareUrl);
  const main = visitor.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: "Single (shared)" })).toBeVisible();
  await expect(main.getByText(/^shared track · 1 track · link expires /u)).toBeVisible();
  await expect(
    main.getByText("adding downloads this track from its original source with the shared tags."),
  ).toBeVisible();
  await main.getByRole("button", { name: "add to library" }).click();
  await expect(notifications(visitor).getByText("track added to your library")).toBeVisible();
  await expect(
    visitor.getByRole("button", { name: "Single (shared).mp3", exact: true }),
  ).toBeVisible();

  const bare = await createShare(request, {
    version: 1,
    kind: "track",
    track: {
      sourceUrl: video.url,
      audioBitrate: "320",
      metadata: { filename: "Bare", title: "Bare", artist: "Soloist", album: "", genre: "" },
    },
  });
  const bareVisitor = await (await newContext()).newPage();
  await bareVisitor.goto(bare.url);
  await expect(bareVisitor.getByRole("main").getByText("no cover art")).toBeAttached();
  await bareVisitor.getByRole("button", { name: "add to library" }).click();
  const download = bareVisitor.getByRole("button", { name: "download track" });
  await expect(download).toBeEnabled(IMPORT_TIMEOUT);
  const saved = await captureDownload(bareVisitor, () => download.click());
  expect(saved.filename).toBe(savedName("Bare.mp3"));
  const { metadata } = await inspectAudio(saved);
  expect(metadata).toMatchObject({ title: "Bare", artist: "Soloist" });
  expect(metadata.picture ?? []).toEqual([]);
});
