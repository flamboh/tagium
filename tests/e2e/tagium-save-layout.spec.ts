import { expect, test } from "@playwright/test";

test("switches and remembers the tagium save theme", async ({ page }) => {
  await page.goto("/?app=tagium-save");

  const root = page.locator("html");
  const initialTheme = await root.getAttribute("data-theme");
  if (initialTheme !== "light" && initialTheme !== "dark") {
    throw new Error("tagium save did not initialize a supported theme");
  }

  const nextTheme = initialTheme === "light" ? "dark" : "light";
  const themeToggle = page.locator('button[aria-label^="switch to "]');
  await themeToggle.click();

  await expect(root).toHaveAttribute("data-theme", nextTheme);
  await expect(page.getByRole("button", { name: `switch to ${initialTheme} mode` })).toBeVisible();

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", nextTheme);
});

test("keeps only the five most recent downloads", async ({ page }) => {
  let downloadNumber = 0;

  await page.route("**/api/cobalt/download", (route) => {
    downloadNumber += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "tunnel",
        url: `https://media.test/history-${downloadNumber}.mp4`,
        filename: `history-${downloadNumber}.mp4`,
      }),
    });
  });
  await page.route("https://media.test/**", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": "5",
      },
      body: "video",
    }),
  );

  await page.goto("/?app=tagium-save");

  for (let index = 1; index <= 6; index += 1) {
    await page.getByRole("textbox", { name: "media url" }).fill(`https://example.com/${index}`);
    await page.getByRole("button", { name: "start video download" }).click();
    await expect(page.getByRole("button", { name: `download history-${index}.mp4` })).toBeVisible();
  }

  const downloads = page.locator("[data-save-download-item]");
  await expect(downloads).toHaveCount(5);
  await expect(downloads).toHaveText([
    "history-6.mp4",
    "history-5.mp4",
    "history-4.mp4",
    "history-3.mp4",
    "history-2.mp4",
  ]);
  await expect(page.getByText("history-1.mp4", { exact: true })).not.toBeAttached();

  const downloadButton = page.getByRole("button", { name: "download history-6.mp4" });
  const downloadEvent = page.waitForEvent("download");
  await downloadButton.click();
  expect((await downloadEvent).suggestedFilename()).toBe("history-6.mp4");
});

test("offers audio returned with picker media", async ({ page }) => {
  await page.route("**/api/cobalt/download", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "picker",
        picker: [{ type: "photo", url: "https://media.test/photo.jpg" }],
        audio: "https://media.test/post-audio.mp3",
        audioFilename: "post-audio.mp3",
      }),
    }),
  );
  await page.route("https://media.test/**", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
      body: "audio",
    }),
  );

  await page.goto("/?app=tagium-save");
  await page.getByRole("textbox", { name: "media url" }).fill("https://example.com/post");
  await page.getByRole("button", { name: "start video download" }).click();
  await page.getByRole("button", { name: "download post-audio.mp3" }).click();

  await expect(page.getByRole("button", { name: "download post-audio.mp3" })).toBeVisible();
  await expect(page.locator("[data-save-download-item]")).toHaveText("post-audio.mp3");
});

test("keeps download errors from shifting the save layout", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let requestCount = 0;
  await page.route("**/api/cobalt/download", (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: "tunnel",
          url: "https://media.test/stable.mp4",
          filename: "stable.mp4",
        }),
      });
    }

    return route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        status: "error",
        error: { code: "error.api.rate_exceeded" },
      }),
    });
  });
  await page.route("https://media.test/**", (route) =>
    route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": "5",
      },
      body: "video",
    }),
  );

  await page.goto("/?app=tagium-save");
  const sourceUrl = page.getByRole("textbox", { name: "media url" });
  const submit = page.getByRole("button", { name: "start video download" });

  await sourceUrl.fill("https://example.com/stable");
  await submit.click();
  const recentDownload = page.locator("[data-save-download-item]");
  await expect(recentDownload).toHaveText("stable.mp4");

  const progressSlot = page.locator("[data-save-download-progress-slot]");
  await expect(progressSlot).toBeVisible();
  const progressBoundsBefore = await progressSlot.boundingBox();
  const downloadBoundsBefore = await recentDownload.boundingBox();
  expect(progressBoundsBefore).not.toBeNull();
  expect(downloadBoundsBefore).not.toBeNull();

  await sourceUrl.fill("https://example.com/failure");
  await submit.click();

  await expect(page.getByRole("alert")).toHaveText(
    "too many download requests. try again shortly.",
  );
  await expect(page.getByRole("button", { name: "retry download" })).toBeVisible();
  await expect(page.getByRole("button", { name: "reset download" })).toBeVisible();
  expect(requestCount).toBe(2);

  expect(await progressSlot.boundingBox()).toEqual(progressBoundsBefore);
  expect(await recentDownload.boundingBox()).toEqual(downloadBoundsBefore);

  await page.getByRole("button", { name: "retry download" }).click();
  await expect.poll(() => requestCount).toBe(3);
  await expect(page.getByRole("alert")).toHaveText(
    "too many download requests. try again shortly.",
  );

  await page.getByRole("button", { name: "reset download" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
