import { randomInt } from "node:crypto";
import type { BrowserContext, Page } from "@playwright/test";
import { captureDownload, inspectAudio } from "../support/audio";
import { test } from "../support/test";
import type { Upstreams } from "../support/upstreams";
import {
  cobaltRequestCount,
  downloadTrackButton,
  field,
  importUrl,
  notifications,
  waitForTrackReady,
  expect,
  SETTLE_TIMEOUT,
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
    "https://youtube.com.example/watch?v=abcdefghijk",
    "https://foo.youtube.com/watch?v=abcdefghijk",
    "https://soundcloud.com.evil/artist/track",
    "https://soundcloud.com/artist/track/extra",
  ]) {
    await importUrl(page, url);
    await expect(
      page.getByText("paste a public soundcloud or youtube track, set, or playlist link"),
    ).toBeVisible();
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

  await expect(
    page.getByText("this soundcloud short link doesn't lead to a track or playlist"),
  ).toBeVisible();
  await expect(notifications(page).getByText("import failed")).toHaveCount(0);
  await expect(page.getByText("no tracks yet")).toBeVisible();
  await expect(urlField(page)).toHaveValue(link);
  expect(await upstreams.calls({ route: "cobalt.resolve" })).toHaveLength(0);
});

test("server link lookups refuse foreign hosts and endless short-link chains", async ({
  request,
  upstreams,
}) => {
  for (const url of [
    "http://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
    "https://example.com/cover.jpg",
    "https://i.ytimg.com.evil.test/cover.jpg",
  ]) {
    const response = await request.get(`/api/youtube-cover?url=${encodeURIComponent(url)}`);
    expect(response.status(), url).toBe(400);
  }

  for (const url of ["https://soundcloud.com.evil/x", "https://example.com/x"]) {
    const response = await request.get(`/api/soundcloud-link?url=${encodeURIComponent(url)}`);
    expect(response.ok(), url).toBe(false);
  }

  const track = await upstreams.soundcloud.track({ cover: null });
  let link = track.url;

  for (let hop = 0; hop < 6; hop += 1) link = await upstreams.soundcloud.shortLink(link);
  const endless = await request.get(`/api/soundcloud-link?url=${encodeURIComponent(link)}`);
  expect(endless.ok()).toBe(false);
  expect(await upstreams.calls({ route: "soundcloud.short_link" })).toHaveLength(5);
  expect(await upstreams.calls({ route: /^soundcloud\.(resolve|track)/u })).toHaveLength(0);
});

test("explains a missing soundcloud set or youtube playlist beside the url field", async ({
  page,
  upstreams,
}) => {
  const set = await upstreams.soundcloud.set({ tracks: [{}], status: 404 });
  const playlist = await upstreams.youtube.playlist({ videos: [{}], missing: true });

  await page.goto("/");

  for (const url of [set.url, playlist.url]) {
    await importUrl(page, url);
    await expect(page.getByText("check that the link is public and still available")).toBeVisible();
    await expect(urlField(page)).toHaveValue(url);
  }

  await expect(notifications(page).getByText("import failed")).toHaveCount(0);
  await expect(page.getByText("no tracks yet")).toBeVisible();
  expect(await upstreams.calls({ route: "soundcloud.resolve.set" })).toHaveLength(1);
  expect(await upstreams.calls({ route: "youtube.playlist" })).toHaveLength(1);
  expect(await upstreams.calls({ route: "cobalt.resolve" })).toHaveLength(0);
});

test("says how many playlist tracks were skipped", async ({ page, upstreams }) => {
  const set = await upstreams.soundcloud.set({
    tracks: [
      { cover: null },
      { cover: null, stub: true, metadata: { kind: "status", status: 404 } },
      { cover: null },
    ],
  });

  const playlist = await upstreams.youtube.playlist({
    videos: [{ cover: null }, { cover: null }, { cover: null }],
    hiddenCount: 2,
  });

  await page.goto("/");
  await importUrl(page, set.url);
  await expect(notifications(page).getByText("added 2 of 3 tracks")).toBeVisible();
  await expect(notifications(page).getByText("1 was private or unavailable.")).toBeVisible();

  await importUrl(page, playlist.url);
  await expect(notifications(page).getByText("added 3 of 5 tracks")).toBeVisible();
  await expect(notifications(page).getByText("2 were private or unavailable.")).toBeVisible();
});

test("explains a playlist with nothing to save beside the url field", async ({
  page,
  upstreams,
}) => {
  const set = await upstreams.soundcloud.set({
    tracks: [{ stub: true, metadata: { kind: "status", status: 404 } }],
  });

  const playlist = await upstreams.youtube.playlist({ videos: [], hiddenCount: 2 });

  await page.goto("/");

  for (const url of [set.url, playlist.url]) {
    const response = page.waitForResponse((candidate) =>
      /\/api\/(soundcloud-set|youtube-playlist)\?/u.test(candidate.url()),
    );

    await importUrl(page, url);
    expect((await response).status()).toBe(422);
    await expect(
      page.getByText("none of this playlist's tracks can be saved. they may be private or removed"),
    ).toBeVisible();
    await expect(urlField(page)).toHaveValue(url);
  }

  await expect(notifications(page).getByText("import failed")).toHaveCount(0);
  await expect(page.getByText("no tracks yet")).toBeVisible();
});

test("reports a soundcloud set or youtube playlist outage as an import failure", async ({
  page,
  upstreams,
}) => {
  const set = await upstreams.soundcloud.set({ tracks: [{}], status: 503 });
  const playlist = await upstreams.youtube.playlist({ videos: [{}], status: 500 });

  for (const url of [set.url, playlist.url]) {
    await page.goto("/");
    await importUrl(page, url);
    await expect(
      notifications(page).getByText("tagium could not import this media. try again in a moment."),
    ).toBeVisible();
    await expect(urlField(page)).toHaveValue(url);
    await expect(page.getByText("check that the link is public and still available")).toHaveCount(
      0,
    );
  }

  await expect(page.getByText("no tracks yet")).toBeVisible();
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

const youtubeBlocking = {
  title: "youtube is blocking downloads right now",
  detail: "youtube is blocking downloads. try again later.",
  toast: "this isn't a problem with your link. try again later.",
  retryable: true,
};

const failureCases: FailureCase[] = [
  {
    name: "an unavailable youtube video",
    arrange: (upstreams) => upstreams.youtube.missingVideo(),
    title: "this video is unavailable",
    detail: "unavailable or blocked by youtube.",
    toast: "it may be private, removed, or temporarily blocked by youtube.",
    retryable: false,
  },
  {
    name: "a private youtube video",
    arrange: youtubeFailing("error.api.content.video.private"),
    title: "we could not access this media",
    detail: "media is private, unavailable, or no longer exists.",
    toast: "check that the link is public and still available.",
    retryable: false,
  },
  {
    name: "a missing soundcloud track",
    arrange: (upstreams) =>
      upstreams.soundcloud.track({ metadata: { kind: "status", status: 404 } }),
    title: "we could not access this media",
    detail: "media is private, unavailable, or no longer exists.",
    toast: "check that the link is public and still available.",
    retryable: false,
    cobaltCalls: 0,
  },
  {
    name: "a soundcloud go+ preview",
    arrange: (upstreams) => upstreams.soundcloud.track({ policy: "SNIP" }),
    title: "this track is a go+ preview",
    detail: "only a go+ preview is available.",
    toast: "soundcloud only streams a preview of this track, so tagium can't save it.",
    retryable: false,
    cobaltCalls: 0,
  },
  {
    name: "a region-locked soundcloud track",
    arrange: (upstreams) => upstreams.soundcloud.track({ policy: "BLOCK" }),
    title: "this media is region-locked",
    detail: "region-locked.",
    toast: "the provider blocks it where our servers are. try another link.",
    retryable: false,
    cobaltCalls: 0,
  },
  {
    name: "a region-locked youtube video",
    arrange: youtubeFailing("error.api.content.video.region"),
    title: "this media is region-locked",
    detail: "region-locked.",
    toast: "the provider blocks it where our servers are. try another link.",
    retryable: false,
  },
  {
    name: "a soundcloud track longer than three hours",
    arrange: (upstreams) => upstreams.soundcloud.track({ durationSec: 3 * 60 * 60 + 1 }),
    title: "this media is too long",
    detail: "longer than 3 hours.",
    toast: "tagium can save media up to 3 hours long.",
    retryable: false,
    cobaltCalls: 0,
  },
  {
    name: "a live youtube stream",
    arrange: youtubeFailing("error.api.content.video.live"),
    title: "live streams can't be saved",
    detail: "live streams can't be saved.",
    toast: "wait until the stream ends, then try again.",
    retryable: false,
  },
  {
    name: "an age-restricted youtube video",
    arrange: youtubeFailing("error.api.content.video.age"),
    title: "this media is age-restricted",
    detail: "age-restricted.",
    toast: "tagium can't sign in to download age-restricted media.",
    retryable: false,
  },
  {
    name: "youtube asking cobalt to sign in",
    arrange: youtubeFailing("error.api.youtube.login"),
    ...youtubeBlocking,
  },
  {
    name: "youtube rate-limiting cobalt",
    arrange: youtubeFailing("error.api.fetch.rate"),
    ...youtubeBlocking,
  },
  {
    name: "an expired cobalt tunnel",
    arrange: async (upstreams) => {
      const video = await upstreams.youtube.video({ title: "Failing Song" });
      await upstreams.cobalt.tunnel(video.url, { kind: "status", status: 404 });

      return video;
    },
    title: "the download link expired",
    detail: "download link expired. try again.",
    toast: "try again to get a fresh link.",
    retryable: true,
  },
  {
    name: "soundcloud segments that keep expiring",
    arrange: (upstreams) => upstreams.soundcloud.track({ tunnel: { kind: "status", status: 403 } }),
    title: "the download link expired",
    detail: "download link expired. try again.",
    toast: "try again to get a fresh link.",
    retryable: true,
    cobaltCalls: 0,
  },
  {
    name: "a drm-protected soundcloud track",
    arrange: (upstreams) => upstreams.soundcloud.track({ transcodings: "encrypted" }),
    title: "this media is drm-protected",
    detail: "this media is drm-protected and can't be downloaded.",
    toast: "tagium can't download drm-protected media. try another link.",
    retryable: false,
    cobaltCalls: 0,
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
    toast: "paste a public soundcloud or youtube track, set, or playlist link.",
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
    name: "a soundcloud track without a playable stream",
    arrange: (upstreams) => upstreams.soundcloud.track({ transcodings: "legacy" }),
    title: "we could not read this media",
    detail: "the media provider returned an unexpected response.",
    toast: "the provider returned an unexpected response. try again or use another link.",
    retryable: true,
    cobaltCalls: 0,
  },
  {
    name: "an unreadable download plan",
    arrange: async (upstreams) => {
      const video = await upstreams.youtube.video({ title: "Failing Song" });
      await upstreams.cobalt.respond(video.url, { kind: "non-json" });

      return video;
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
    name: "too many soundcloud download requests",
    arrange: async (upstreams, context) => {
      const ip = `203.0.113.${randomInt(1, 255)}`;
      await context.setExtraHTTPHeaders({ "cf-connecting-ip": ip });
      await upstreams.rateLimits.limit("SOUNDCLOUD_CLIENT_RATE_LIMITER", ip, 0);

      return upstreams.soundcloud.track({ title: "Failing Song" });
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
    title: "we could not read this media",
    detail: "the media provider returned an unexpected response.",
    toast: "the provider returned an unexpected response. try again or use another link.",
    retryable: true,
  },
];

for (const failure of failureCases) {
  test(`shows why ${failure.name} cannot be downloaded`, async ({ page, context, upstreams }) => {
    const media = await failure.arrange(upstreams, context);

    await page.goto("/");
    await importUrl(page, media.url);

    await expect(page.getByRole("button", { name: /track has an error$/u })).toBeVisible(
      SETTLE_TIMEOUT,
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

    await page.getByRole("button", { name: /^track actions for / }).click();
    await expect(page.getByRole("menuitem", { name: "remove track" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "retry download" })).toHaveCount(
      failure.retryable ? 1 : 0,
    );
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
  const video = await upstreams.youtube.video({ title: "Slow Start", cover: null });
  await upstreams.cobalt.emptyTunnel(video.url, 2);

  await page.goto("/");
  await importUrl(page, video.url);
  await waitForTrackReady(page);

  expect(await upstreams.calls({ route: "cobalt.tunnel.audio" })).toHaveLength(3);
  const exported = await captureDownload(page, () => downloadTrackButton(page).click());
  expect((await inspectAudio(exported)).metadata.title).toBe("Slow Start");
});

test("retries soundcloud stream segments that fail or arrive empty", async ({
  page,
  upstreams,
}) => {
  const track = await upstreams.soundcloud.track({
    title: "Slow Start",
    cover: null,
    tunnel: [{ kind: "empty" }, { kind: "status", status: 503 }, { kind: "ok" }],
  });

  await page.goto("/");
  await importUrl(page, track.url);
  await waitForTrackReady(page);

  expect(await upstreams.calls({ route: "soundcloud.segment" })).toHaveLength(6);
  const exported = await captureDownload(page, () => downloadTrackButton(page).click());
  expect((await inspectAudio(exported)).metadata.title).toBe("Slow Start");
});

test("fetches a fresh soundcloud stream when its segment links expire", async ({
  page,
  upstreams,
}) => {
  const track = await upstreams.soundcloud.track({
    title: "Fresh Link",
    cover: null,
    tunnel: [{ kind: "status", status: 403 }, { kind: "ok" }],
  });

  await page.goto("/");
  await importUrl(page, track.url);
  await waitForTrackReady(page);

  expect(await upstreams.calls({ route: "soundcloud.stream" })).toHaveLength(2);
  const exported = await captureDownload(page, () => downloadTrackButton(page).click());
  expect((await inspectAudio(exported)).metadata.title).toBe("Fresh Link");
});
