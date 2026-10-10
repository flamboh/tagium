import type { Page } from "@playwright/test";
import { FAKE_POSTHOG_ORIGIN } from "../harness/protocol.ts";
import { audioFixture, captureDownload } from "../support/audio";
import { expect, IMPORT_TIMEOUT, test } from "../support/test";
import type { AnalyticsEvent, Upstreams } from "../support/upstreams";
import { saveApp } from "../save-app/save";
import { libraryCount, pickFiles } from "../local-editing/workspace";
import { downloadTrackButton, importUrl, waitForTrackReady } from "../url-import/helpers";

const SENSITIVE_KEY = /url|href|referrer|pathname|filename|title|artist|album|text|elements/iu;

const eventsNamed = async (upstreams: Upstreams, names: string[]) => {
  let events: AnalyticsEvent[] = [];
  await expect
    .poll(
      async () => {
        events = await upstreams.analyticsEvents();

        return names.filter((name) => !events.some((event) => event.event === name));
      },
      { message: "analytics events still missing", ...IMPORT_TIMEOUT },
    )
    .toEqual([]);

  return events;
};

const only = (events: AnalyticsEvent[], name: string) => {
  const matching = events.filter((event) => event.event === name);
  expect(matching, `${name} events`).toHaveLength(1);

  return matching[0]!.properties;
};

const expectPrivate = (events: AnalyticsEvent[], secrets: string[]) => {
  const serialized = JSON.stringify(events);

  for (const secret of secrets) {
    expect(serialized, `analytics payload contains "${secret}"`).not.toContain(secret);
  }

  for (const { event, properties } of events) {
    for (const [key, value] of Object.entries(properties)) {
      if (key === "$lib_custom_api_host") {
        expect(value, `${event}.${key}`).toBe(FAKE_POSTHOG_ORIGIN);
        continue;
      }

      expect(key, `${event} sends a content property`).not.toMatch(SENSITIVE_KEY);
      expect(JSON.stringify(value), `${event}.${key}`).not.toMatch(/https?:\/\//iu);
    }
  }
};

const expectStorageFree = async (page: Page) => {
  expect(
    await page.evaluate(() =>
      [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((key) =>
        /^ph_|posthog/iu.test(key),
      ),
    ),
  ).toEqual([]);
  expect(
    (await page.context().cookies()).filter((cookie) => /^ph_|posthog/iu.test(cookie.name)),
  ).toEqual([]);
};

test("the editor reports import and export milestones without links or track content", async ({
  page,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({ title: "Secret Session", author: "Hidden Act" });
  const local = audioFixture("mp3", "Private Demo Take.mp3");

  await page.goto("/");
  await pickFiles(page, [local.upload]);
  await libraryCount(page, 1);
  await importUrl(page, video.url);
  await waitForTrackReady(page);
  await captureDownload(page, () => downloadTrackButton(page).click());

  const events = await eventsNamed(upstreams, [
    "$pageview",
    "audio_upload_completed",
    "media_link_processed",
    "import_started",
    "import_finished",
    "export_prepared",
  ]);

  for (const { event, properties } of events) {
    expect(properties, event).toMatchObject({ app_id: "tagium" });

    if (!event.startsWith("$")) {
      expect(properties, event).toMatchObject({ deploy_env: "production", release_sha: "e2e" });
    }
  }

  expect(only(events, "audio_upload_completed")).toMatchObject({
    requested_count: 1,
    accepted_count: 1,
    duplicate_count: 0,
    parse_rejected_count: 0,
  });
  expect(only(events, "media_link_processed")).toMatchObject({
    provider: "youtube",
    media_kind: "track",
    outcome: "accepted",
  });
  expect(only(events, "import_finished")).toMatchObject({
    provider: "youtube",
    import_kind: "single",
    outcome: "completed",
    total_count: 1,
    completed_count: 1,
    failed_count: 0,
    canceled_count: 0,
  });
  expect(only(events, "export_prepared")).toMatchObject({
    export_kind: "track",
    track_count: 1,
    size_bucket: "under_10_mb",
  });
  expect(events.filter((event) => event.event.startsWith("download_"))).toEqual([]);
  expectPrivate(events, [
    video.id,
    "Secret Session",
    "Hidden Act",
    "Private Demo",
    "Fixture Tone",
    "Tagium Fixtures",
    "Fixture Album",
    "127.0.0.1",
  ]);
  await expectStorageFree(page);
});

test("the editor reports a failed import by category without its link", async ({
  page,
  upstreams,
}) => {
  const stuck = await upstreams.youtube.video({ title: "Stuck Upload", cover: null });
  await upstreams.cobalt.fail(stuck.url, "error.api.timed_out", 500);

  await page.goto("/");
  await importUrl(page, stuck.url);

  const events = await eventsNamed(upstreams, ["import_failure_category", "import_finished"]);
  expect(only(events, "import_failure_category")).toMatchObject({
    app_id: "tagium",
    provider: "youtube",
    import_kind: "single",
    code: "timeout",
  });
  expect(only(events, "import_finished")).toMatchObject({
    provider: "youtube",
    outcome: "failed",
    total_count: 1,
    completed_count: 0,
    failed_count: 1,
  });
  expectPrivate(events, [stuck.id, "Stuck Upload"]);
});

test("the editor reports missing and drm-protected imports by their category", async ({
  page,
  upstreams,
}) => {
  const missing = await upstreams.youtube.missingVideo();
  const protectedTrack = await upstreams.soundcloud.track({ title: "Locked Song", cover: null });
  await upstreams.cobalt.fail(protectedTrack.url, "error.api.soundcloud.maybe_drm");

  const categories = async () =>
    (await upstreams.analyticsEvents()).filter(
      (event) => event.event === "import_failure_category",
    );

  await page.goto("/");
  await importUrl(page, missing.url);
  await expect.poll(async () => (await categories()).length, IMPORT_TIMEOUT).toBe(1);
  await importUrl(page, protectedTrack.url);

  await expect
    .poll(
      async () =>
        (await categories()).map(({ properties }) => ({
          provider: properties.provider,
          code: properties.code,
        })),
      IMPORT_TIMEOUT,
    )
    .toEqual([
      { provider: "youtube", code: "private_or_missing" },
      { provider: "soundcloud", code: "unsupported_source" },
    ]);
  expectPrivate(await categories(), [missing.id, "Locked Song"]);
});

test("tagium save reports each download outcome with its provider and failure code", async ({
  page,
  upstreams,
}) => {
  const track = await upstreams.soundcloud.track({
    title: "Quiet Room",
    author: "Private Person",
    cover: null,
  });

  const busy = await upstreams.youtube.video({
    title: "Busy Clip",
    author: "Somebody",
    cover: null,
  });

  await upstreams.cobalt.capacity(busy.url, { retryAfter: "1", times: 1 });
  const missing = await upstreams.youtube.missingVideo();
  const save = saveApp(page);

  await save.open();
  await save.save(track.url, "Quiet Room - Private Person (soundcloud).opus");
  await save.download("Quiet Room - Private Person (soundcloud).opus");

  const saved = await eventsNamed(upstreams, [
    "download_started",
    "download_resolved",
    "download_finished",
  ]);

  expect(only(saved, "download_started")).toMatchObject({
    app_id: "tagium-save",
    provider: "soundcloud",
    requested_mode: "auto",
    requested_audio_format: "best",
    is_retry: false,
  });
  expect(only(saved, "download_resolved")).toMatchObject({
    provider: "soundcloud",
    result_kind: "file",
    resource_count: 1,
  });
  expect(only(saved, "download_finished")).toMatchObject({
    provider: "soundcloud",
    outcome: "completed",
    output_format: "opus",
    size_bucket: "under_10_mb",
  });

  await save.start(busy.url);
  await expect(save.retry).toBeVisible(IMPORT_TIMEOUT);
  await save.retry.click();
  await expect(save.url).toHaveValue("", IMPORT_TIMEOUT);

  await save.start(missing.url);
  await expect(save.alert).toBeVisible(IMPORT_TIMEOUT);

  await expect
    .poll(
      async () =>
        (await upstreams.analyticsEvents())
          .filter((event) => event.event === "download_finished")
          .map(({ properties }) => [
            properties.provider,
            properties.outcome,
            properties.failure_stage,
            properties.failure_code,
          ]),
      IMPORT_TIMEOUT,
    )
    .toEqual([
      ["soundcloud", "completed", undefined, undefined],
      ["youtube", "failed", "planning", "capacity"],
      ["youtube", "completed", undefined, undefined],
      ["youtube", "failed", "planning", "private_or_missing"],
    ]);
  const events = await upstreams.analyticsEvents();
  expect(
    events
      .filter((event) => event.event === "download_started")
      .map(({ properties }) => [properties.provider, properties.is_retry]),
  ).toEqual([
    ["soundcloud", false],
    ["youtube", false],
    ["youtube", true],
    ["youtube", false],
  ]);
  expect(only(events, "export_prepared")).toMatchObject({
    export_kind: "track",
    provider: "soundcloud",
    output_format: "opus",
  });

  for (const { event, properties } of events) {
    expect(properties, event).toMatchObject({ app_id: "tagium-save" });
    expect(event, "tagium save sends an editor event").not.toMatch(
      /^(import|audio|album|tracks)_/u,
    );
  }

  expectPrivate(events, [
    track.url,
    "Quiet Room",
    "Private Person",
    busy.id,
    "Busy Clip",
    missing.id,
    "127.0.0.1",
  ]);
  await expectStorageFree(page);
});

test("each app reports page views under its own app and first-party host only", async ({
  page,
  baseURL,
  upstreams,
}) => {
  await page.context().route(
    (url) => ["tagium.app", "save.tagium.app"].includes(url.hostname),
    async (route) => {
      const url = new URL(route.request().url());

      const response = await route.fetch({
        url: `${baseURL}${url.pathname}${url.search}`,
        maxRetries: 3,
      });

      await route.fulfill({ response });
    },
  );

  await page.goto("https://save.tagium.app/");
  await expect(saveApp(page).url).toBeEditable();
  await expect
    .poll(async () => (await upstreams.analyticsEvents()).map(({ properties }) => properties), {
      ...IMPORT_TIMEOUT,
    })
    .toContainEqual(expect.objectContaining({ app_id: "tagium-save", $host: "save.tagium.app" }));

  await page.goto("https://tagium.app/");
  await expect(page.getByRole("button", { name: "start media import" })).toBeVisible();
  await expect
    .poll(async () => (await upstreams.analyticsEvents()).map(({ properties }) => properties), {
      ...IMPORT_TIMEOUT,
    })
    .toContainEqual(expect.objectContaining({ app_id: "tagium", $host: "tagium.app" }));

  await page.goto("https://tagium.app/?app=tagium-save");
  await expect(page.getByRole("button", { name: "start media import" })).toBeVisible();
  await page.goto("/?app=tagium-save");
  await expect(saveApp(page).url).toBeEditable();
  await expect
    .poll(
      async () =>
        (await upstreams.analyticsEvents()).filter(
          ({ properties }) => properties.app_id === "tagium-save",
        ).length,
      IMPORT_TIMEOUT,
    )
    .toBeGreaterThan(1);

  const events = await upstreams.analyticsEvents();

  for (const { event, properties } of events) {
    const host = properties.$host;

    if (properties.app_id === "tagium-save") {
      expect([undefined, "save.tagium.app"], `${event} host`).toContain(host);
    } else {
      expect(properties.app_id, event).toBe("tagium");
      expect([undefined, "tagium.app"], `${event} host`).toContain(host);
    }
  }

  expectPrivate(events, ["127.0.0.1"]);
});

test("imports and saves keep working when analytics cannot be reached", async ({
  page,
  upstreams,
}) => {
  await page.route(`${FAKE_POSTHOG_ORIGIN}/**`, (route) => route.abort());
  const video = await upstreams.youtube.video({ cover: null });

  const track = await upstreams.soundcloud.track({
    title: "Offline",
    author: "Saver",
    cover: null,
  });

  await page.goto("/");
  await importUrl(page, video.url);
  await waitForTrackReady(page);
  await captureDownload(page, () => downloadTrackButton(page).click());

  const save = saveApp(page);
  await save.open();
  await save.save(track.url, "Offline - Saver (soundcloud).opus");
  await save.download("Offline - Saver (soundcloud).opus");
  expect(await upstreams.analyticsEvents()).toEqual([]);
});
