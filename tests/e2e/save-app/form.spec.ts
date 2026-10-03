import { expect, IMPORT_TIMEOUT, test } from "../support/test";
import { saveApp } from "./save";

test.describe.configure({ timeout: 120_000 });

test("explains links that are not complete web addresses without contacting cobalt", async ({
  page,
  upstreams,
}) => {
  const save = saveApp(page);
  const error = page.locator("#media-url-error");

  await save.open();
  await expect(save.submit).toBeDisabled();
  await save.url.fill("   ");
  await expect(save.submit).toBeDisabled();

  for (const value of [
    "abc",
    "youtube.com/watch?v=x",
    "ftp://example.com/a",
    "javascript:alert(1)",
  ]) {
    await save.url.fill(value);
    await save.url.press("Enter");
    await expect(error).toHaveText("enter a complete http or https url");
    await expect(save.url).toHaveAttribute("aria-invalid", "true");
    await expect(save.url).toHaveAttribute("aria-describedby", "media-url-error");
    await save.url.press("End");
    await save.url.press("Backspace");
    await expect(error).toHaveText("");
    await expect(save.url).toHaveAttribute("aria-invalid", "false");
  }

  await save.url.fill("abc");
  await save.submit.click();
  await expect(error).toHaveText("enter a complete http or https url");
  await expect(save.progress).toHaveCount(0);
  expect(await upstreams.calls({ route: "cobalt.resolve" })).toHaveLength(0);
});

test("sends a pasted list of links as one link", async ({
  page,
  context,
  browserName,
  upstreams,
}) => {
  const first = await upstreams.youtube.video();
  const second = await upstreams.soundcloud.track();
  const pasted = `${first.url} ${second.url}`;
  await upstreams.cobalt.fail(pasted, "error.api.link.invalid");
  const save = saveApp(page);
  if (browserName === "chromium") {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  }

  await save.open();
  await page.evaluate((text) => navigator.clipboard.writeText(text), `${first.url}\n${second.url}`);
  await save.url.focus();
  await page.keyboard.press("ControlOrMeta+V");
  await expect(save.url).toHaveValue(pasted);
  await save.submit.click();

  await expect(save.alert).toHaveText("this link is not supported.", IMPORT_TIMEOUT);
  await expect(save.retry).toHaveCount(0);
  const resolves = await upstreams.calls({ route: "cobalt.resolve" });
  expect(resolves.map((call) => JSON.parse(call.requestBody!).url)).toEqual([pasted]);
});
