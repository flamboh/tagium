import { expect, JOURNEY_TIMEOUT, test } from "./fixtures";
import { importAlbum, openShareDialog, randomIp, SHARE_URL, stubClipboard } from "./helpers";

test.describe.configure({ timeout: JOURNEY_TIMEOUT });

test("failed publications keep the preview, explain the failure and can be retried", async ({
  page,
  context,
  upstreams,
}) => {
  const clipboard = await stubClipboard(context);
  await importAlbum(page, upstreams, {
    title: "Retry Album",
    author: "Patient",
    videos: [{ title: "Only Song" }],
  });
  const publications: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/manifests")) {
      publications.push(request.url());
    }
  });

  let dialog = await openShareDialog(page, "Retry Album");
  await dialog.getByRole("button", { name: "cancel" }).click();
  await expect(dialog).not.toBeAttached();
  expect(publications).toEqual([]);

  const limitedIp = randomIp();
  await upstreams.rateLimits.limit("SHARE_CREATE_RATE_LIMITER", limitedIp, 0);
  await context.setExtraHTTPHeaders({ "cf-connecting-ip": limitedIp });
  dialog = await openShareDialog(page, "Retry Album");
  const create = dialog.getByRole("button", { name: "create share link" });
  const alert = dialog.getByRole("alert");
  await create.click();
  await expect(alert).toHaveText(
    "too many share requests; try again shortly. no link was created.",
  );
  await expect(dialog.getByRole("list", { name: "track preview" })).toHaveText(/Only Song/u);
  await expect(dialog.getByRole("button", { name: "cancel" })).toBeEnabled();

  for (const status of [503, 400]) {
    await page.route("**/api/manifests", (route) => route.fulfill({ status }), { times: 1 });
    await create.click();
    await expect(alert, `status ${status}`).toHaveText("the share link could not be created.");
    await expect(create).toBeEnabled();
  }

  await context.setExtraHTTPHeaders({ "cf-connecting-ip": randomIp() });
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    "**/api/manifests",
    async (route) => {
      await released;
      await route.fallback();
    },
    { times: 1 },
  );
  await create.click();
  const publishing = dialog.getByRole("button", { name: "creating link…" });
  await expect(publishing).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "cancel" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "close" })).not.toBeAttached();
  await page.keyboard.press("Escape");
  await expect(publishing).toBeVisible();
  release();

  const link = dialog.getByRole("textbox", { name: "share link" });
  await expect(link).toHaveValue(SHARE_URL);
  const shareUrl = await link.inputValue();
  expect(publications).toHaveLength(4);

  await dialog.getByRole("button", { name: "copy link" }).click();
  await expect(dialog.getByRole("button", { name: "copied" })).toBeVisible();
  expect(await clipboard.copied(page)).toEqual([shareUrl]);

  await clipboard.deny(page);
  await expect(dialog.getByRole("button", { name: "copy link" })).toBeVisible();
  await dialog.getByRole("button", { name: "copy link" }).click();
  await expect(dialog.getByRole("status")).toHaveText("select and copy the link");
  await expect(link).toBeFocused();
  expect(
    await link.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd]),
  ).toEqual([0, shareUrl.length]);

  await dialog.getByRole("button", { name: "done" }).click();
  await expect(dialog).not.toBeAttached();
});
