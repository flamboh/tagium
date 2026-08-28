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
  const iconSwap = themeToggle.locator("[data-icon-swap-state]");
  const icon = themeToggle.locator('[data-icon-swap="icon"]');
  const bounds = await themeToggle.boundingBox();
  if (!bounds) throw new Error("theme toggle bounds were not found");

  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await expect(themeToggle).toHaveCSS("scale", "0.97");
  await page.mouse.up();

  await expect(root).toHaveAttribute("data-theme", nextTheme);
  await expect(page.getByRole("button", { name: `switch to ${initialTheme} mode` })).toBeVisible();
  await expect(iconSwap).toHaveAttribute(
    "data-icon-swap-state",
    nextTheme === "dark" ? "second" : "first",
  );

  await expect(icon).toHaveCSS("transition-duration", "0.08s");
  await expect(icon).toHaveCSS("transition-property", "filter, opacity");
  await expect(icon).toHaveCSS("opacity", "1");
  await expect(icon).toHaveCSS("filter", "none");
  await expect(themeToggle.locator("[data-save-theme-icon]")).toHaveCount(1);
  await expect(
    themeToggle.locator(`[data-save-theme-icon="${nextTheme === "dark" ? "sun" : "moon"}"]`),
  ).toBeVisible();

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", nextTheme);
});

test("updates save control colors with the active theme", async ({ page }) => {
  await page.goto("/?app=tagium-save");

  const root = page.locator("html");
  const initialTheme = await root.getAttribute("data-theme");
  if (initialTheme !== "light" && initialTheme !== "dark") {
    throw new Error("tagium save did not initialize a supported theme");
  }

  const controls = [
    page.getByRole("button", { name: "download settings" }),
    page.getByRole("button", { name: "start video download" }),
  ];
  const readColors = () =>
    Promise.all(
      controls.map((control) =>
        control.evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.backgroundColor, style.borderColor, style.color];
        }),
      ),
    );

  const nextTheme = initialTheme === "light" ? "dark" : "light";
  await page.getByRole("button", { name: `switch to ${nextTheme} mode` }).click();
  await expect(root).toHaveAttribute("data-theme", nextTheme);

  const colorsAfterThemeSwap = await readColors();
  await page.waitForTimeout(250);
  const settledColors = await readColors();

  expect(colorsAfterThemeSwap).toEqual(settledColors);
});

test("spins the settings icon between closed and open states", async ({ page }) => {
  await page.goto("/?app=tagium-save");

  const settings = page.getByRole("button", { name: "download settings" });
  const motion = settings.locator('[data-save-settings-icon="motion"]');
  const cog = settings.locator('[data-save-settings-icon="cog"]');
  const arrow = settings.locator('[data-save-settings-icon="arrow"]');

  const bounds = await settings.boundingBox();
  if (!bounds) throw new Error("settings trigger bounds were not found");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await expect(settings).toHaveCSS("scale", "0.97");
  await page.mouse.up();

  await expect(settings).toHaveAttribute("data-state", "open");
  await expect(motion).toHaveCSS("transition-duration", "0.28s");
  await expect(motion).toHaveCSS("transition-timing-function", "cubic-bezier(0.34, 1.56, 0.64, 1)");
  await expect(cog).toHaveCSS("transition-delay", "0.03s");
  await expect(arrow).toHaveCSS("transition-delay", "0.07s");
  await expect(cog).toHaveCSS("transition-duration", "0.08s");
  await expect(arrow).toHaveCSS("transition-duration", "0.08s");
  await expect(cog).toHaveCSS("transition-property", "filter, opacity");
  await expect(arrow).toHaveCSS("transition-property", "filter, opacity");
  await expect(cog).toHaveCSS("opacity", "0");
  await expect(cog).toHaveCSS("filter", "blur(2px)");
  await expect(arrow).toHaveCSS("opacity", "1");
  await expect(arrow).toHaveCSS("filter", "none");

  await settings.click();
  await expect(settings).toHaveAttribute("data-state", "closed");
  await expect(cog).toHaveCSS("transition-delay", "0.07s");
  await expect(arrow).toHaveCSS("transition-delay", "0.03s");
  await expect(cog).toHaveCSS("opacity", "1");
  await expect(cog).toHaveCSS("filter", "none");
  await expect(arrow).toHaveCSS("opacity", "0");
  await expect(arrow).toHaveCSS("filter", "blur(2px)");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await settings.click();
  await expect(settings).toHaveAttribute("data-state", "open");
  await expect(motion).toHaveCSS("transition-property", "none");
  await expect(cog).toHaveCSS("opacity", "0");
  await expect(arrow).toHaveCSS("opacity", "1");
});

test("keeps the tagium save logo fixed through download states", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "layout geometry is covered in Chromium");
  await page.setViewportSize({ width: 320, height: 568 });

  let releasePlan = () => {};
  const planGate = new Promise<void>((resolve) => {
    releasePlan = resolve;
  });

  await page.route("**/api/cobalt/download", async (route) => {
    await planGate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "tunnel",
        url: "https://media.test/stable-layout.mp4",
        filename: "stable-layout.mp4",
      }),
    });
  });
  await page.route("https://media.test/stable-layout.mp4", (route) =>
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

  const logo = page.getByRole("heading", { name: "tagium save" });
  const readLogoTop = async () => {
    const bounds = await logo.boundingBox();
    if (!bounds) throw new Error("tagium logo bounds were not found");
    return bounds.y;
  };

  const idleTop = await readLogoTop();
  await page.getByRole("textbox", { name: "media url" }).fill("https://example.com/video");
  const submit = page.getByRole("button", { name: "start video download" });
  const submitSwap = submit.locator("[data-icon-swap-state]");
  const submitIcon = submit.locator('[data-icon-swap="icon"]');
  const submitBounds = await submit.boundingBox();
  if (!submitBounds) throw new Error("submit button bounds were not found");

  await page.mouse.move(
    submitBounds.x + submitBounds.width / 2,
    submitBounds.y + submitBounds.height / 2,
  );
  await page.mouse.down();
  await expect(submit).toHaveCSS("scale", "0.97");
  await page.mouse.up();
  await expect(page.getByText("preparing", { exact: true })).toBeVisible();
  await expect(submitSwap).toHaveAttribute("data-icon-swap-state", "second");
  await expect(submitIcon).toHaveCSS("opacity", "1");
  await expect(submitIcon).toHaveCSS("filter", "none");
  await expect(submit.locator("[data-media-url-submit-icon]")).toHaveCount(1);
  await expect(submit.locator('[data-media-url-submit-icon="loading"]')).toBeVisible();
  await expect(submitIcon.locator("svg")).toHaveCSS("animation-name", "none");
  expect(await readLogoTop()).toBe(idleTop);

  releasePlan();
  await expect(page.getByRole("button", { name: "download stable-layout.mp4" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "media url" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "media url" })).toHaveValue("");
  expect(await readLogoTop()).toBe(idleTop);
});

test("reserves progress space above recent downloads", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "layout geometry is covered in Chromium");
  await page.setViewportSize({ width: 320, height: 568 });

  let requestNumber = 0;
  let releaseSecondPlan = () => {};
  const secondPlanGate = new Promise<void>((resolve) => {
    releaseSecondPlan = resolve;
  });

  await page.route("**/api/cobalt/download", async (route) => {
    requestNumber += 1;
    if (requestNumber === 2) await secondPlanGate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "tunnel",
        url: `https://media.test/reserved-${requestNumber}.mp4`,
        filename: `reserved-${requestNumber}.mp4`,
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
  const mediaUrl = page.getByRole("textbox", { name: "media url" });
  await mediaUrl.fill("https://example.com/one");
  await page.getByRole("button", { name: "start video download" }).click();

  const firstDownload = page.locator("[data-save-download-item]");
  await expect(firstDownload).toHaveText("reserved-1.mp4");
  const settledBounds = await firstDownload.boundingBox();
  if (!settledBounds) throw new Error("recent download bounds were not found");

  await mediaUrl.fill("https://example.com/two");
  await page.getByRole("button", { name: "start video download" }).click();
  await expect(page.getByText("preparing", { exact: true })).toBeVisible();
  expect((await firstDownload.boundingBox())?.y).toBe(settledBounds.y);

  releaseSecondPlan();
  await expect(page.getByRole("button", { name: "download reserved-2.mp4" })).toBeVisible();
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
  const downloadSwap = downloadButton.locator("[data-icon-swap-state]");
  const downloadIcon = downloadButton.locator('[data-icon-swap="icon"]');
  const downloadBounds = await downloadButton.boundingBox();
  if (!downloadBounds) throw new Error("download button bounds were not found");

  const downloadEvent = page.waitForEvent("download");
  await page.mouse.move(
    downloadBounds.x + downloadBounds.width / 2,
    downloadBounds.y + downloadBounds.height / 2,
  );
  await page.mouse.down();
  await expect(downloadButton).toHaveCSS("scale", "0.97");
  await page.mouse.up();
  expect((await downloadEvent).suggestedFilename()).toBe("history-6.mp4");
  await expect(downloadSwap).toHaveAttribute("data-icon-swap-state", "second");
  await expect(downloadIcon).toHaveCSS("opacity", "1");
  await expect(downloadIcon).toHaveCSS("filter", "none");
  await expect(downloadButton.locator("[data-save-download-icon]")).toHaveCount(1);
  await expect(downloadButton.locator('[data-save-download-icon="confirmation"]')).toBeVisible();
  await page.waitForTimeout(900);
  await expect(downloadButton.locator('[data-save-download-icon="confirmation"]')).toBeVisible();
  await expect(downloadSwap).toHaveAttribute("data-icon-swap-state", "first", { timeout: 2000 });
  await expect(downloadButton.locator('[data-save-download-icon="download"]')).toBeVisible();
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
