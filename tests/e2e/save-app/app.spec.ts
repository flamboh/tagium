import { expect, test } from "../support/test";
import { SAVE_PATH, saveApp } from "./save";

test("opens to an empty save form", async ({ page }) => {
  const save = saveApp(page);

  await save.open();
  await expect(page).toHaveTitle("tagium save");
  await expect(page.getByRole("heading", { level: 1, name: "tagium save" })).toBeVisible();
  await expect(save.url).toHaveAttribute("placeholder", "paste a media link");
  await expect(save.url).toHaveValue("");
  await expect(save.submit).toBeDisabled();
  await expect(save.settings).toBeEnabled();
  await expect(page.getByRole("link", { name: "flamboh" })).toHaveAttribute(
    "href",
    "https://x.com/flambohh",
  );
  await expect(page.getByRole("link", { name: "cobalt" })).toHaveAttribute(
    "href",
    "https://cobalt.tools/",
  );
  await expect(page.getByRole("button", { name: "open dev panel" })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "notifications alt+t", exact: true }),
  ).toBeAttached();
  await expect(save.recent).toHaveCount(0);
  await expect(save.progress).toHaveCount(0);
  await expect(save.alert).toHaveCount(0);
});

test("follows the system theme and remembers a chosen theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const root = page.locator("html");

  await page.goto(SAVE_PATH);
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "switch to light mode" }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("button", { name: "switch to dark mode" })).toBeVisible();

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("button", { name: "switch to dark mode" })).toBeVisible();
});

test("save.tagium.app opens tagium save, and tagium.app ignores the preview switch", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  try {
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "save.tagium.app" && url.hostname !== "tagium.app") {
        await route.abort();
        return;
      }
      const response = await route.fetch({ url: `${baseURL}${url.pathname}${url.search}` });
      await route.fulfill({ response });
    });
    const page = await context.newPage();

    await page.goto("https://save.tagium.app/");
    await expect(page).toHaveTitle("tagium save");
    await expect(page.getByRole("button", { name: "start video download" })).toBeVisible();

    await page.goto("https://tagium.app/?app=tagium-save");
    await expect(page).toHaveTitle("tagium");
    await expect(page.getByRole("button", { name: "start media import" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("neither app sends analytics from a build without an analytics key", async ({
  page,
  context,
  upstreams,
}) => {
  const analytics: string[] = [];
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.hostname.endsWith("posthog.com") ||
      url.hostname === "t.tagium.app" ||
      url.pathname.includes("posthog")
    ) {
      analytics.push(request.url());
    }
  });
  const track = await upstreams.soundcloud.track({
    title: "Quiet",
    author: "Private",
    cover: null,
  });
  const failing = await upstreams.youtube.missingVideo();
  const save = saveApp(page);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "start media import" })).toBeVisible();

  await save.open();
  await save.save(track.url, "Quiet - Private (soundcloud).opus");
  await save.download("Quiet - Private (soundcloud).opus");
  await save.start(failing.url);
  await expect(save.alert).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("button", { name: "start media import" })).toBeVisible();

  expect(analytics).toEqual([]);
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith("ph_") || key.includes("posthog")),
    ),
  ).toEqual([]);
});
