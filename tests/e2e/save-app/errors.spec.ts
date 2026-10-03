import type { Page } from "@playwright/test";
import { FAKE_COBALT_ORIGIN } from "../harness/protocol.ts";
import type { Upstreams } from "../support/upstreams";
import { expect, IMPORT_TIMEOUT, test } from "../support/test";
import { saveApp, storedFileCount } from "./save";

const copy = {
  busy: "downloads are busy. try again in a moment.",
  rateLimited: "too many download requests. try again shortly.",
  timeout: "download timed out. try again.",
  unavailable: "downloads are temporarily unavailable.",
  unexpected: "the media provider returned an unexpected response.",
  unsupported: "this link is not supported.",
  missing: "media is private, unavailable, or no longer exists.",
  drm: "this media is drm-protected and can't be downloaded.",
};

type Failure = {
  name: string;
  message: string;
  retryable: boolean;
  slow?: boolean;
  arrange: (upstreams: Upstreams) => Promise<string>;
};

const soundcloudFailing = (code: string, status?: number) => async (upstreams: Upstreams) => {
  const track = await upstreams.soundcloud.track({ cover: null });
  await upstreams.cobalt.fail(track.url, code, status);
  return track.url;
};

const failures: Failure[] = [
  {
    name: "a provider timeout",
    message: copy.timeout,
    retryable: true,
    arrange: soundcloudFailing("error.api.timed_out", 500),
  },
  {
    name: "an unreachable download service",
    message: copy.unavailable,
    retryable: true,
    arrange: soundcloudFailing("error.api.unreachable", 500),
  },
  {
    name: "an empty provider response",
    message: copy.unexpected,
    retryable: true,
    arrange: soundcloudFailing("error.api.fetch.empty", 500),
  },
  {
    name: "a link cobalt does not support",
    message: copy.unsupported,
    retryable: false,
    arrange: async (upstreams) => {
      const url = `https://example.com/watch/${crypto.randomUUID()}`;
      await upstreams.cobalt.fail(url, "error.api.link.invalid");
      return url;
    },
  },
  {
    name: "a plan that would process media on cobalt",
    message: copy.unsupported,
    retryable: false,
    arrange: async (upstreams) => {
      const video = await upstreams.youtube.video({ cover: null });
      await upstreams.cobalt.plan(video.url, {
        status: "tunnel",
        url: `${FAKE_COBALT_ORIGIN}/tunnel?id=hls`,
        filename: "stream.mp4",
      });
      return video.url;
    },
  },
  {
    name: "a missing youtube video",
    message: copy.missing,
    retryable: false,
    arrange: async (upstreams) => (await upstreams.youtube.missingVideo()).url,
  },
  {
    name: "a private youtube video",
    message: copy.missing,
    retryable: false,
    arrange: async (upstreams) => {
      const video = await upstreams.youtube.video({ cover: null });
      await upstreams.cobalt.fail(video.url, "error.api.content.video.private");
      return video.url;
    },
  },
  {
    name: "drm-protected soundcloud audio",
    message: copy.drm,
    retryable: false,
    arrange: soundcloudFailing("error.api.soundcloud.maybe_drm"),
  },
  {
    name: "a drm-protected youtube video",
    message: copy.drm,
    retryable: false,
    arrange: async (upstreams) => {
      const video = await upstreams.youtube.video({ cover: null });
      await upstreams.cobalt.fail(video.url, "error.api.youtube.drm");
      return video.url;
    },
  },
  {
    name: "a picker with nothing to choose",
    message: copy.unexpected,
    retryable: true,
    arrange: async (upstreams) => {
      const post = await upstreams.picker({ items: [] });
      return post.url;
    },
  },
  {
    name: "tunnels that stay empty",
    message: copy.unexpected,
    retryable: true,
    slow: true,
    arrange: async (upstreams) => {
      const track = await upstreams.soundcloud.track({ cover: null });
      await upstreams.cobalt.emptyTunnel(track.url);
      return track.url;
    },
  },
];

const expectFailure = async (
  page: Page,
  url: string,
  failure: Omit<Failure, "arrange" | "name">,
) => {
  const save = saveApp(page);
  await expect(save.alert).toHaveText(failure.message, IMPORT_TIMEOUT);
  await expect(save.retry).toHaveCount(failure.retryable ? 1 : 0);
  await expect(save.reset).toBeVisible();
  await expect(save.url).toHaveValue(url);
  await expect(save.url).toBeEditable();
  await expect(save.recent).toHaveCount(0);
};

for (const failure of failures) {
  test(`explains ${failure.name}`, async ({ page, upstreams }) => {
    const url = await failure.arrange(upstreams);
    const save = saveApp(page);
    let downloads = 0;
    page.on("download", () => {
      downloads += 1;
    });

    await save.open();
    await save.start(url);
    await expectFailure(page, url, failure);

    if (failure.retryable && !failure.slow) {
      await save.retry.click();
      await expect
        .poll(
          async () => (await upstreams.calls({ route: "cobalt.resolve" })).length,
          IMPORT_TIMEOUT,
        )
        .toBe(2);
      await expectFailure(page, url, failure);
    }

    await save.reset.click();
    await expect(save.alert).toHaveCount(0);
    await expect(save.url).toHaveValue("");
    expect(downloads).toBe(0);
  });
}

test("explains an invalid response from cobalt", async ({ page, upstreams }) => {
  const track = await upstreams.soundcloud.track({ cover: null });
  await upstreams.cobalt.respond(track.url, { kind: "non-json" });
  const save = saveApp(page);

  await save.open();
  await save.start(track.url);
  await expect(save.alert).toBeVisible(IMPORT_TIMEOUT);
  await expect(save.alert).toHaveText(copy.unexpected, { timeout: 1_000 });
});

test("retries a busy download after the advertised wait and saves it", async ({
  page,
  upstreams,
}) => {
  const track = await upstreams.soundcloud.track({
    title: "Busy Day",
    author: "Queue",
    cover: null,
  });
  await upstreams.cobalt.capacity(track.url, { retryAfter: "7", times: 1 });
  const save = saveApp(page);

  await save.open();
  const planResponse = page.waitForResponse("**/api/cobalt/download");
  await save.start(track.url);
  const busy = await planResponse;
  expect(busy.status()).toBe(503);
  expect(busy.headers()["retry-after"]).toBe("7");
  await expectFailure(page, track.url, { message: copy.busy, retryable: true });

  await save.retry.click();
  await expect(save.downloadButton("Busy Day - Queue (soundcloud).opus")).toBeVisible(
    IMPORT_TIMEOUT,
  );
  await expect(save.alert).toHaveCount(0);
});

test("retries media that was busy to fetch and saves it", async ({ page, upstreams }) => {
  const track = await upstreams.soundcloud.track({
    title: "Busy Tunnel",
    author: "Queue",
    cover: null,
  });
  await upstreams.cobalt.tunnel(track.url, [{ kind: "capacity", retryAfter: "3" }, { kind: "ok" }]);
  const save = saveApp(page);

  await save.open();
  await save.start(track.url);
  await expectFailure(page, track.url, { message: copy.busy, retryable: true });

  await save.retry.click();
  await expect(save.downloadButton("Busy Tunnel - Queue (soundcloud).opus")).toBeVisible(
    IMPORT_TIMEOUT,
  );
});

test("explains repeated downloads beyond the session limit", async ({
  page,
  context,
  baseURL,
  upstreams,
}) => {
  const session = `e2e-${crypto.randomUUID()}`;
  await context.addCookies([{ name: "tagium_client_id", value: session, url: baseURL! }]);
  await upstreams.rateLimits.limit("COBALT_SESSION_RATE_LIMITER", session, 1);
  const first = await upstreams.soundcloud.track({
    title: "Allowed",
    author: "Limit",
    cover: null,
  });
  const second = await upstreams.soundcloud.track({
    title: "Limited",
    author: "Limit",
    cover: null,
  });
  const save = saveApp(page);

  await save.open();
  await save.save(first.url, "Allowed - Limit (soundcloud).opus");
  await save.start(second.url);
  await expect(save.alert).toHaveText(copy.rateLimited, IMPORT_TIMEOUT);
  await expect(save.retry).toBeVisible();
  await expect(save.downloadButton("Allowed - Limit (soundcloud).opus")).toBeVisible();
  expect(await upstreams.calls({ route: "cobalt.resolve" })).toHaveLength(1);
});

test("recovers silently when the media briefly comes back empty", async ({ page, upstreams }) => {
  const track = await upstreams.soundcloud.track({
    title: "Second Try",
    author: "Echo",
    cover: null,
  });
  await upstreams.cobalt.emptyTunnel(track.url, 2);
  const save = saveApp(page);

  await save.open();
  await save.save(track.url, "Second Try - Echo (soundcloud).opus");
  await expect(save.alert).toHaveCount(0);
  expect(await upstreams.calls({ route: "cobalt.tunnel.audio" })).toHaveLength(3);
});

test("a failed save keeps earlier files and the layout in place", async ({ page, upstreams }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const kept = await upstreams.soundcloud.track({ title: "Kept", author: "Stable", cover: null });
  const failing = await upstreams.soundcloud.track({ cover: null });
  await upstreams.cobalt.fail(failing.url, "error.api.timed_out", 500);
  const save = saveApp(page);
  const slot = page.locator("[data-save-download-progress-slot]");

  await save.open();
  await save.save(kept.url, "Kept - Stable (soundcloud).opus");
  const slotBefore = await slot.boundingBox();
  const rowBefore = await save.rows.first().boundingBox();

  await save.start(failing.url);
  await expect(save.alert).toHaveText(copy.timeout, IMPORT_TIMEOUT);
  expect(await slot.boundingBox()).toEqual(slotBefore);
  expect(await save.rows.first().boundingBox()).toEqual(rowBefore);

  await save.reset.click();
  await expect(save.alert).toHaveCount(0);
  await expect(save.rows).toHaveText(["Kept - Stable (soundcloud).opus"]);
  await save.download("Kept - Stable (soundcloud).opus");
});

test("explains media that cannot be processed and leaves nothing behind", async ({
  page,
  browserName,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({ title: "Broken", cover: null });
  await upstreams.cobalt.tunnel(video.url, {
    kind: "status",
    status: 200,
    body: "not media at all",
  });
  const save = saveApp(page);

  await save.open();
  await save.configure({ mode: "audio", audio: "mp3" });
  await save.start(video.url);
  await expectFailure(page, video.url, {
    message: "download failed. try again or use another link.",
    retryable: true,
  });
  if (browserName !== "webkit") await expect.poll(() => storedFileCount(page)).toBe(0);
});
