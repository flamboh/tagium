import { expect, test } from "@playwright/test";

test("imports a YouTube playlist as an album-backed download queue", async ({ page }) => {
  const playlistUrl = "https://www.youtube.com/playlist?list=PLESiES1i-ThqUjxot6jWLDu90fxtkcpA0";
  const sourceUrls: string[] = [];
  const sourceYears: number[] = [];
  let releaseDownloads = () => {};
  const downloadsReleased = new Promise<void>((resolve) => {
    releaseDownloads = resolve;
  });

  await page.route("**/api/youtube-playlist?**", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("url")).toBe(playlistUrl);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        title: "YouTube Playlist",
        artist: "Playlist Owner",
        genre: "",
        year: 2022,
        isAlbum: false,
        tracks: [
          {
            title: "First Video",
            url: "https://www.youtube.com/watch?v=first-video",
            duration: 120,
            trackNumber: 1,
          },
          {
            title: "Second Video",
            url: "https://www.youtube.com/watch?v=second-video",
            duration: 180,
            trackNumber: 2,
          },
        ],
      }),
    });
  });
  await page.route("**/api/cobalt/audio", async (route) => {
    const body = route.request().postDataJSON() as { url: string; year: number };
    sourceUrls.push(body.url);
    sourceYears.push(body.year);
    await downloadsReleased;
    await route
      .fulfill({ status: 502, contentType: "text/plain", body: "test download released" })
      .catch(() => {});
  });

  try {
    await page.goto("/");
    await page.getByRole("textbox", { name: "media url" }).fill(playlistUrl);
    await page.getByRole("button", { name: "start media import" }).click();

    await expect(page.getByText("YouTube Playlist", { exact: true })).toBeVisible();
    await expect(page.locator('input[name="year"]')).toHaveValue("2022");
    await expect(page.getByText("downloading 0/2", { exact: true })).toBeVisible();
    await expect
      .poll(() => sourceUrls)
      .toEqual([
        "https://www.youtube.com/watch?v=first-video",
        "https://www.youtube.com/watch?v=second-video",
      ]);
    await expect.poll(() => sourceYears).toEqual([2022, 2022]);
  } finally {
    releaseDownloads();
  }
});
