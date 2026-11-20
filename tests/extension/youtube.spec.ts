import { chromium, expect, test } from "@playwright/test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  importUrl,
  field,
  waitForTrackReady,
  audioPreview,
  useSettings,
  removeTrack,
} from "../e2e/url-import/helpers";

test("approved audio reaches local processing; cancel never falls back; media failure does", async () => {
  const profile = await mkdtemp(join(tmpdir(), "tagium-extension-"));
  const extension = resolve("extensions/youtube/.output/chrome-mv3-dev");
  const fixture = await readFile("tests/e2e/fixtures/waveform.m4a");

  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });

  let mediaFails = false;
  let serverFails = false;
  let serverRequests = 0;
  let mediaRequests = 0;
  let playerRequests = 0;

  try {
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.hostname === "www.youtube.com" && url.pathname === "/youtubei/v1/player") {
        playerRequests += 1;

        await route.fulfill({
          json: {
            playabilityStatus: { status: "OK" },
            videoDetails: {
              videoId: "abcdefghijk",
              title: "extension fixture",
              author: "test artist",
              lengthSeconds: "6",
              channelId: "test",
              isLiveContent: false,
            },
            streamingData: {
              expiresInSeconds: "3600",
              adaptiveFormats: [
                {
                  itag: 140,
                  url: "https://fixture.googlevideo.com/videoplayback",
                  mimeType: 'audio/mp4; codecs="mp4a.40.2"',
                  bitrate: 128000,
                  contentLength: String(fixture.length),
                  approxDurationMs: "6000",
                  audioQuality: "AUDIO_QUALITY_MEDIUM",
                  audioSampleRate: "44100",
                  audioChannels: 1,
                },
              ],
            },
          },
        });
      } else if (url.hostname === "fixture.googlevideo.com") {
        mediaRequests += 1;

        await route.fulfill({
          status: mediaFails ? 403 : 200,
          contentType: "audio/mp4",
          body: mediaFails ? "" : fixture,
        });
      } else if (url.origin === "http://localhost:5173") {
        if (url.pathname === "/api/cobalt/audio") {
          serverRequests += 1;
          await route.fulfill({
            status: serverFails ? 400 : 200,
            json: serverFails
              ? { status: "error", error: { code: "error.api.youtube.login" } }
              : {
                  status: "local-processing",
                  type: "audio",
                  tunnel: ["http://localhost:5173/extension-fixture.m4a"],
                  audio: { copy: true, format: "m4a", bitrate: "128" },
                  output: {
                    type: "audio/mp4",
                    filename: "server fixture.m4a",
                    metadata: {
                      title: "server fixture",
                      artist: "test artist",
                      album: "provider album",
                    },
                  },
                },
          });
        } else if (url.pathname === "/extension-fixture.m4a") {
          await route.fulfill({ contentType: "audio/mp4", body: fixture });
        } else if (url.pathname.startsWith("/api/")) {
          await route.fulfill({ status: 204 });
        } else await route.continue();
      } else if (
        url.protocol === "chrome-extension:" ||
        url.protocol === "data:" ||
        url.protocol === "blob:"
      ) {
        await route.continue();
      } else await route.abort();
    });
    await useSettings(context, { audioFormat: "best" });
    const page = await context.newPage();

    const connect = async () => {
      await page.goto("http://localhost:5173");
      await page.getByRole("button", { name: "connect extension", exact: true }).click();
      await expect(page.getByText("youtube extension connected", { exact: true })).toBeVisible();
    };

    const sourceUrl = "https://www.youtube.com/watch?v=abcdefghijk";
    await connect();
    let tabPromise = context.waitForEvent("page");
    await importUrl(page, sourceUrl);
    let job = await tabPromise;
    await expect(job.getByRole("button", { name: "allow this download" })).toBeEnabled();
    expect(playerRequests).toBe(0);
    await job.getByRole("button", { name: "allow this download" }).click();
    await expect(job.getByRole("status")).toHaveText(
      "audio sent. return to tagium to finish processing.",
      { timeout: 15_000 },
    );
    await waitForTrackReady(page);
    await expect(field(page, "title")).toHaveValue("extension fixture");
    await expect(field(page, "artist")).toHaveValue("test artist");
    await expect(field(page, "album")).toHaveValue("extension fixture");
    await expect(audioPreview(page)).toContainText("0:00 / 0:06");
    expect(serverRequests).toBe(0);
    expect(playerRequests).toBe(1);
    expect(mediaRequests).toBe(1);
    await job.close();

    await connect();
    tabPromise = context.waitForEvent("page");
    await importUrl(page, sourceUrl);
    job = await tabPromise;
    await expect(job.getByRole("button", { name: "allow this download" })).toBeEnabled();
    const closed = job.waitForEvent("close");
    await removeTrack(page, "watch.mp3");
    await closed;
    expect(serverRequests).toBe(0);
    expect(playerRequests).toBe(1);

    await connect();
    mediaFails = true;
    tabPromise = context.waitForEvent("page");
    await importUrl(page, sourceUrl);
    job = await tabPromise;
    await job.getByRole("button", { name: "allow this download" }).click();
    await waitForTrackReady(page);
    await expect(field(page, "title")).toHaveValue("server fixture");
    await expect(field(page, "album")).toHaveValue("server fixture");
    expect(serverRequests).toBe(1);
    await job.close();

    await connect();
    serverFails = true;
    tabPromise = context.waitForEvent("page");
    await importUrl(page, sourceUrl);
    job = await tabPromise;
    await job.getByRole("button", { name: "allow this download" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "both youtube download routes failed" }),
    ).toBeVisible();
    expect(serverRequests).toBe(2);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
