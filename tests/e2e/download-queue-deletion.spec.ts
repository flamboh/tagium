import { expect, test } from "@playwright/test";

test("removing downloading and queued tracks updates the current run", async ({ page }) => {
  const sourceUrls: string[] = [];
  let releaseDownloads = () => {};
  const downloadsReleased = new Promise<void>((resolve) => {
    releaseDownloads = resolve;
  });

  await page.route("**/api/soundcloud-set?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        title: "Deletion Test Set",
        artist: "Test Artist",
        genre: "Test",
        isAlbum: true,
        tracks: Array.from({ length: 5 }, (_value, index) => ({
          title: `Track ${index + 1}`,
          url: `https://soundcloud.com/test/track-${index + 1}`,
          duration: 60,
          trackNumber: index + 1,
        })),
      }),
    });
  });
  await page.route("**/api/cobalt/audio", async (route) => {
    const body = route.request().postDataJSON() as { url: string };
    sourceUrls.push(body.url);
    await downloadsReleased;
    await route
      .fulfill({ status: 502, contentType: "text/plain", body: "test download released" })
      .catch(() => {});
  });

  try {
    await page.goto("/");
    await page
      .getByRole("textbox", { name: "media url" })
      .fill("https://soundcloud.com/test/sets/deletion-test");
    await page.getByRole("button", { name: "start media import" }).click();

    await expect(page.getByText("downloading 0/5", { exact: true })).toBeVisible();
    await expect.poll(() => sourceUrls).toHaveLength(3);

    const removeButtons = page.getByRole("button", { name: "remove track" });
    await removeButtons.first().click();
    await page
      .getByRole("dialog", { name: "remove track?" })
      .getByRole("button", { name: "remove track" })
      .click();

    await expect(page.getByText("downloading 0/4", { exact: true })).toBeVisible();
    await expect.poll(() => sourceUrls).toHaveLength(4);

    await removeButtons.last().click();
    await page
      .getByRole("dialog", { name: "remove track?" })
      .getByRole("button", { name: "remove track" })
      .click();

    await expect(page.getByText("downloading 0/3", { exact: true })).toBeVisible();
    expect(sourceUrls).not.toContain("https://soundcloud.com/test/track-5");
  } finally {
    releaseDownloads();
  }
});
