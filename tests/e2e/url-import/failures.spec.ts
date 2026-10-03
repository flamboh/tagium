import { randomInt } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { captureDownload, inspectAudio } from "../support/audio";
import { expect, IMPORT_TIMEOUT, test } from "../support/test";
import type { Upstreams } from "../support/upstreams";
import {
  cobaltRequestCount,
  downloadTrackButton,
  field,
  importUrl,
  notifications,
  waitForTrackReady,
} from "./helpers";

const urlField = (page: Page) => page.getByRole("textbox", { name: "media url" });

test("rejects incomplete and unsupported links beside the url field", async ({
  page,
  upstreams,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "start media import" })).toBeDisabled();

  await importUrl(page, "not a url");
  await expect(page.getByText("enter a complete http or https url")).toBeVisible();
  await page.getByRole("button", { name: "settings" }).click();
  await expect(urlField(page)).toBeHidden();
  await page.getByRole("button", { name: "back to workspace" }).click();
  await expect(urlField(page)).toHaveValue("not a url");
  await expect(page.getByText("enter a complete http or https url")).toBeVisible();

  for (const url of [
    "https://example.com/audio.mp3",
    "http://www.youtube.com/watch?v=abcdefghijk",
  ]) {
    await importUrl(page, url);
    await expect(page.getByText("try a public soundcloud or youtube track url")).toBeVisible();
    await expect(urlField(page)).toHaveValue(url);
  }
  await expect(page.getByText("no tracks yet")).toBeVisible();
  expect(await upstreams.calls({ route: /^(cobalt|youtube|soundcloud)/u })).toHaveLength(0);
});

test("explains a soundcloud short link that does not lead to soundcloud", async ({
  page,
  upstreams,
}) => {
  const link = await upstreams.soundcloud.shortLink("https://example.com/not-soundcloud");

  await page.goto("/");
  await importUrl(page, link);

  const toast = notifications(page);
  await expect(toast.getByText("import failed")).toBeVisible();
  await expect(
    toast.getByText("tagium could not import this media. try again in a moment."),
  ).toBeVisible();
  await expect(page.getByText("no tracks yet")).toBeVisible();
  await expect(urlField(page)).toHaveValue(link);
  expect(await upstreams.calls({ route: "cobalt.resolve" })).toHaveLength(0);
});

type FailureCase = {
  name: string;
  arrange: (upstreams: Upstreams, context: BrowserContext) => Promise<{ url: string }>;
  title: string;
  detail: string;
  toast: string;
  retryable: boolean;
  cobaltCalls?: number;
};

const youtubeFailing = (code: string) => async (upstreams: Upstreams) => {
  const video = await upstreams.youtube.video({ title: "Failing Song" });
  await upstreams.cobalt.fail(video.url, code);
  return video;
};

const failureCases: FailureCase[] = [
  {
    name: "a private or removed youtube video",
    arrange: (upstreams) => upstreams.youtube.missingVideo(),
    title: "we could not access this media",
    detail: "media is private, unavailable, or no longer exists.",
    toast: "check that the link is public and still available, then try again.",
    retryable: false,
  },
  {
    name: "a missing soundcloud track",
    arrange: async (upstreams) => {
      const track = await upstreams.soundcloud.track({
        metadata: { kind: "status", status: 404 },
      });
      await upstreams.cobalt.fail(track.url, "error.api.fetch.soundcloud.resolve_fetch.404");
      return track;
    },
    title: "we could not access this media",
    detail: "media is private, unavailable, or no longer exists.",
    toast: "check that the link is public and still available, then try again.",
    retryable: false,
  },
  {
    name: "drm-protected media",
    arrange: youtubeFailing("error.api.youtube.drm"),
    title: "this media is drm-protected",
    detail: "this media is drm-protected and can't be downloaded.",
    toast: "tagium can't download drm-protected media. try another link.",
    retryable: false,
  },
  {
    name: "a link cobalt does not support",
    arrange: youtubeFailing("error.api.link.unsupported"),
    title: "this link is not supported",
    detail: "this link is not supported.",
    toast: "try a public soundcloud or youtube track url.",
    retryable: false,
  },
  {
    name: "an unreachable download service",
    arrange: youtubeFailing("error.api.unreachable"),
    title: "downloads are temporarily unavailable",
    detail: "downloads are temporarily unavailable.",
    toast: "tagium could not reach the download service. try again soon.",
    retryable: true,
  },
  {
    name: "a download that timed out",
    arrange: youtubeFailing("error.api.timed_out"),
    title: "the download took too long",
    detail: "download timed out. try again.",
    toast: "try again. if it keeps failing, try another link.",
    retryable: true,
  },
  {
    name: "an empty soundcloud stream",
    arrange: async (upstreams) => {
      const track = await upstreams.soundcloud.track();
      await upstreams.cobalt.fail(track.url, "error.api.fetch.soundcloud.stream_parse");
      return track;
    },
    title: "we could not read this media",
    detail: "the media provider returned an unexpected response.",
    toast: "the provider returned an unexpected response. try again or use another link.",
    retryable: true,
  },
  {
    name: "too many download requests",
    arrange: async (upstreams, context) => {
      const ip = `203.0.113.${randomInt(1, 255)}`;
      await context.setExtraHTTPHeaders({ "cf-connecting-ip": ip });
      await upstreams.rateLimits.limit("COBALT_CLIENT_RATE_LIMITER", ip, 0);
      return upstreams.youtube.video({ title: "Failing Song" });
    },
    title: "too many download requests",
    detail: "too many download requests. try again shortly.",
    toast: "wait a moment, then try the download again.",
    retryable: true,
    cobaltCalls: 0,
  },
  {
    name: "a download plan cobalt cannot vouch for",
    arrange: async (upstreams) => {
      const video = await upstreams.youtube.video({ title: "Failing Song" });
      await upstreams.cobalt.respond(video.url, { kind: "invalid-machine-id" });
      return video;
    },
    title: "download failed",
    detail: "download failed. try again or use another link.",
    toast: "tagium could not download this track. try again or use another link.",
    retryable: true,
  },
];

for (const failure of failureCases) {
  test(`shows why ${failure.name} cannot be downloaded`, async ({ page, context, upstreams }) => {
    const media = await failure.arrange(upstreams, context);

    await page.goto("/");
    await importUrl(page, media.url);

    await expect(page.getByRole("button", { name: /track has an error$/u })).toBeVisible(
      IMPORT_TIMEOUT,
    );
    await expect(page.getByText(failure.title, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(failure.detail, { exact: true })).toBeVisible();
    await expect(notifications(page).getByText(failure.toast)).toBeVisible();
    await expect(downloadTrackButton(page)).toBeDisabled();
    await expect(page.getByRole("button", { name: "download all" })).toBeDisabled();
    await expect(field(page, "title")).toBeEditable();
    expect(await upstreams.calls({ route: "cobalt.resolve" })).toHaveLength(
      failure.cobaltCalls ?? 1,
    );

    if (failure.retryable) {
      await page.getByRole("button", { name: /^track actions for / }).click();
      await expect(page.getByRole("menuitem", { name: "retry download" })).toBeVisible();
    }
  });
}

test("recovers from a busy download service when the track is retried", async ({
  page,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({
    title: "Busy Song",
    author: "Crowd",
    cover: null,
  });
  await upstreams.cobalt.capacity(video.url, { retryAfter: "7", times: 1 });
  const capacityResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/cobalt/audio") && response.status() === 503,
  );

  await page.goto("/");
  await importUrl(page, video.url);
  expect((await capacityResponse).headers()["retry-after"]).toBe("7");
  await expect(page.getByText("downloads are busy", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("downloads are busy. try again in a moment.")).toBeVisible();
  await expect(
    notifications(page).getByText(
      "too many downloads are running right now. try again in a moment.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "track actions for Busy Song.mp3" }).click();
  await page.getByRole("menuitem", { name: "retry download" }).click();
  await waitForTrackReady(page);
  await expect(page.getByText("downloads are busy. try again in a moment.")).toBeHidden();

  const exported = await captureDownload(page, () => downloadTrackButton(page).click());
  expect((await inspectAudio(exported)).metadata).toMatchObject({
    title: "Busy Song",
    artist: "Crowd",
  });
  expect(await cobaltRequestCount(upstreams, video.url)).toBe(2);
});

test("imports a track whose audio stream starts out empty", async ({ page, upstreams }) => {
  const track = await upstreams.soundcloud.track({ title: "Slow Start", cover: null });
  await upstreams.cobalt.emptyTunnel(track.url, 2);

  await page.goto("/");
  await importUrl(page, track.url);
  await waitForTrackReady(page);

  expect(await upstreams.calls({ route: "cobalt.tunnel.audio" })).toHaveLength(3);
  const exported = await captureDownload(page, () => downloadTrackButton(page).click());
  expect((await inspectAudio(exported)).metadata.title).toBe("Slow Start");
});
