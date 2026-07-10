import { expect, test } from "@playwright/test";

test("unkeyed E2E builds make no PostHog requests", async ({ page }) => {
  const postHogRequests: string[] = [];
  page.on("request", (request) => {
    const hostname = new URL(request.url()).hostname;
    if (hostname.endsWith("posthog.com")) postHogRequests.push(request.url());
  });

  await page.goto("/");
  await page.getByRole("button", { name: "start media import" }).isVisible();
  await page.waitForTimeout(2_000);

  expect(postHogRequests).toEqual([]);
});
