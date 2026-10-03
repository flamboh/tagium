import { expect, test } from "./fixtures";
import {
  albumManifest,
  createShare,
  notifications,
  RECEIPTS_KEY,
  seedReceipt,
  storedReceipts,
  stubClipboard,
} from "./helpers";

test("the creator's browser stops a share from its page after a failed attempt, and visitors can't", async ({
  page,
  context,
  request,
  upstreams,
  newContext,
}) => {
  const video = await upstreams.youtube.video({ title: "Owned Song" });
  const share = await createShare(
    request,
    albumManifest({ title: "Owned Album", artist: "Owner", tracks: [{ video }] }),
  );
  await seedReceipt(context, share);

  const visitor = await (await newContext()).newPage();
  await visitor.goto(share.url);
  await expect(visitor.getByRole("heading", { level: 1, name: "Owned Album" })).toBeVisible();
  await expect(visitor.getByRole("button", { name: "add to library" })).toBeVisible();
  await expect(visitor.getByRole("button", { name: "stop sharing" })).not.toBeAttached();

  await page.goto(share.url);
  const stop = page.getByRole("banner").getByRole("button", { name: "stop sharing" });
  await stop.click();
  const dialog = page.getByRole("dialog", { name: "stop sharing this album?" });
  await expect(
    dialog.getByText(
      "the link will stop working immediately. anyone who already added the album keeps their copy.",
    ),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "keep sharing" }).click();
  await expect(dialog).not.toBeAttached();
  expect((await request.get(`/api/manifests/${share.slug}`)).status()).toBe(200);

  await page.route(`**/api/manifests/${share.slug}`, (route) =>
    route.request().method() === "DELETE" ? route.abort("internetdisconnected") : route.fallback(),
  );
  await stop.click();
  await dialog.getByRole("button", { name: "stop sharing" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "sharing could not be stopped. check your connection and try again.",
  );
  expect(await storedReceipts(page)).toEqual([
    { slug: share.slug, expiresAt: share.expiresAt, token: share.revocationToken },
  ]);
  expect((await request.get(`/api/manifests/${share.slug}`)).status()).toBe(200);

  await page.unrouteAll();
  const revocation = page.waitForRequest((candidate) => candidate.method() === "DELETE");
  await dialog.getByRole("button", { name: "stop sharing" }).click();
  expect((await revocation).headers()["authorization"]).toBe(`Bearer ${share.revocationToken}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "this share is no longer available" }),
  ).toBeVisible();
  await expect(notifications(page).getByText("sharing stopped")).toBeVisible();
  await expect(notifications(page).getByText("the link no longer works.")).toBeVisible();
  expect(await storedReceipts(page)).toEqual([]);
  expect((await request.get(`/api/manifests/${share.slug}`)).status()).toBe(404);

  await visitor.getByRole("button", { name: "add to library" }).click();
  await expect(
    visitor.getByRole("heading", { level: 1, name: "this share is no longer available" }),
  ).toBeVisible();
  await expect(visitor).toHaveURL(share.url);
});

test("expired or foreign stored permissions don't offer stop sharing, and malformed entries are ignored", async ({
  page,
  context,
  request,
  upstreams,
}) => {
  const video = await upstreams.youtube.video();
  const manifest = albumManifest({ title: "Kept Album", artist: "Owner", tracks: [{ video }] });
  const expired = await createShare(request, manifest);
  const owned = await createShare(request, manifest);
  const foreign = await createShare(request, manifest);
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: RECEIPTS_KEY,
    value: JSON.stringify([
      { slug: expired.slug, expiresAt: "2001-01-01T00:00:00.000Z", token: expired.revocationToken },
      "not a receipt",
      { slug: foreign.slug },
      { slug: owned.slug, expiresAt: owned.expiresAt, token: owned.revocationToken },
    ]),
  });

  await page.goto(expired.url);
  await expect(page.getByRole("button", { name: "add to library" })).toBeVisible();
  await expect(page.getByRole("button", { name: "stop sharing" })).not.toBeAttached();

  await page.goto(foreign.url);
  await expect(page.getByRole("button", { name: "add to library" })).toBeVisible();
  await expect(page.getByRole("button", { name: "stop sharing" })).not.toBeAttached();

  await page.goto(owned.url);
  await page.getByRole("banner").getByRole("button", { name: "stop sharing" }).click();
  await page
    .getByRole("dialog", { name: "stop sharing this album?" })
    .getByRole("button", { name: "stop sharing" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "this share is no longer available" }),
  ).toBeVisible();
  expect((await request.get(`/api/manifests/${owned.slug}`)).status()).toBe(404);
  expect((await request.get(`/api/manifests/${expired.slug}`)).status()).toBe(200);
});

test("opening a share while tagium is open in another tab offers to copy the link there", async ({
  page,
  context,
  request,
  upstreams,
}) => {
  const video = await upstreams.youtube.video();
  const share = await createShare(
    request,
    albumManifest({ title: "Tab Album", artist: "Owner", tracks: [{ video }] }),
  );
  const clipboard = await stubClipboard(context);

  await page.goto("/");
  const shareTab = await context.newPage();
  const toast = notifications(shareTab).getByRole("listitem").filter({
    hasText:
      "tagium is already open in another tab. copy the link and add the album there instead.",
  });
  const openShareBesideTagium = () =>
    expect(async () => {
      await shareTab.goto(share.url);
      await expect(toast).toBeVisible({ timeout: 5_000 });
    }).toPass();

  await openShareBesideTagium();
  await toast.getByRole("button", { name: "copy link" }).click();
  await expect(notifications(shareTab).getByText("share link copied")).toBeVisible();
  expect(await clipboard.copied(shareTab)).toEqual([share.url]);

  await clipboard.deny(shareTab);
  await openShareBesideTagium();
  await toast.getByRole("button", { name: "copy link" }).click();
  await expect(notifications(shareTab).getByText("copy failed")).toBeVisible();
  await expect(
    notifications(shareTab).getByText(`copy this link and paste it in the other tab: ${share.url}`),
  ).toBeVisible();
  await expect(shareTab.getByRole("button", { name: "add to library" })).toBeVisible();
});
