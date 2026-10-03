import type { Page } from "@playwright/test";
import { APP_SETTINGS_STORAGE_KEY } from "../../../src/features/settings/settings";
import { THEME_STORAGE_KEY } from "../../../src/features/theme/theme";
import { audioFixture, captureDownload, expectLosslessAudio, inspectAudio } from "../support/audio";
import { expect, IMPORT_TIMEOUT, test } from "./fixtures";
import { startImport, IMPORT_HEAVY, savedName } from "./helpers";

test.describe.configure(IMPORT_HEAVY);

const LINK_SWITCHES = [
  "sync artist with the album artist",
  "sync year with the album year",
  "sync genre with the album genre",
  "sync artwork with the album cover",
  "sync track number with the sidebar order",
  "sync filename with the track title",
  "sync album with the track title",
  "sync album artist with the track artist",
] as const;

const openSettings = async (page: Page, section: "importing" | "editing" | "linking" | "about") => {
  if (!(await page.getByRole("button", { name: "back to workspace" }).isVisible())) {
    await page.getByRole("button", { name: "settings", exact: true }).click();
  }
  await page
    .getByRole("navigation", { name: "settings sections" })
    .getByRole("button", { name: section, exact: true })
    .click();
  return page.getByRole("region", { name: section, exact: true });
};

const settingsControls = (page: Page) => ({
  format: page.getByRole("button", { name: /^download format, /u }),
  bitrate: page.getByRole("button", { name: /^mp3 bitrate, /u }),
  soundcloudCover: page.getByRole("checkbox", {
    name: /^use the soundcloud album cover for every track/u,
  }),
  downloadAfterImport: page.getByRole("checkbox", {
    name: /^start download immediately after import/u,
  }),
  advanced: page.getByRole("checkbox", { name: /^show advanced fields/u }),
  link: (name: string) => page.getByRole("switch", { name, exact: true }),
});

const chooseOption = async (
  page: Page,
  trigger: string | RegExp,
  group: string,
  option: RegExp,
) => {
  await page.getByRole("button", { name: trigger }).click();
  await page.getByRole("group", { name: group }).getByRole("button", { name: option }).click();
};

const expectSettings = async (
  page: Page,
  expected: {
    format: string;
    bitrate: string;
    soundcloudCover: boolean;
    downloadAfterImport: boolean;
    advanced: boolean;
    links: boolean;
  },
) => {
  const controls = settingsControls(page);
  await openSettings(page, "importing");
  await expect(controls.format).toHaveAccessibleName(`download format, ${expected.format}`);
  await expect(controls.bitrate).toHaveAccessibleName(`mp3 bitrate, ${expected.bitrate} kbps`);
  await expect(controls.soundcloudCover).toBeChecked({ checked: expected.soundcloudCover });
  await expect(controls.downloadAfterImport).toBeChecked({ checked: expected.downloadAfterImport });
  await openSettings(page, "editing");
  await expect(controls.advanced).toBeChecked({ checked: expected.advanced });
  await openSettings(page, "linking");
  for (const name of LINK_SWITCHES.slice(0, expected.advanced ? undefined : -1)) {
    await expect(controls.link(name), name).toHaveAttribute("aria-checked", String(expected.links));
  }
};

const imageSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0x89) return { width: view.getUint32(16), height: view.getUint32(20) };
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1]!;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
    }
    offset += 2 + view.getUint16(offset + 2);
  }
  return null;
};

const mp3Bitrate = (bytes: Uint8Array) => {
  let offset =
    bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33
      ? 10 + ((bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!)
      : 0;
  while (!(bytes[offset] === 0xff && (bytes[offset + 1]! & 0xe0) === 0xe0)) offset += 1;
  const mpeg1 = (bytes[offset + 1]! & 0x18) === 0x18;
  const index = bytes[offset + 2]! >> 4;
  return (
    mpeg1
      ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
      : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
  )[index];
};

test("every setting persists across reloads, and unreadable stored settings fall back to defaults", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          audioBitrate: "999",
          audioFormat: "flac",
          downloadAfterImport: "yes",
          metadataLinks: { artist: "no" },
        }),
      ),
    APP_SETTINGS_STORAGE_KEY,
  );
  await page.reload();
  const defaults = {
    format: "mp3",
    bitrate: "320",
    soundcloudCover: true,
    downloadAfterImport: false,
    advanced: false,
    links: true,
  };
  await expectSettings(page, defaults);
  await page.evaluate((key) => localStorage.setItem(key, "{not json"), APP_SETTINGS_STORAGE_KEY);
  await page.reload();
  await expectSettings(page, defaults);

  const controls = settingsControls(page);
  await openSettings(page, "importing");
  await chooseOption(page, /^download format, /u, "download format", /^best compatible/u);
  await chooseOption(page, /^mp3 bitrate, /u, "mp3 bitrate", /^128 kbps$/u);
  await controls.soundcloudCover.click();
  await controls.downloadAfterImport.click();
  await openSettings(page, "editing");
  await page.locator("label").filter({ hasText: "show advanced fields" }).click();
  await expect(controls.advanced).toBeChecked();
  await openSettings(page, "linking");
  for (const name of LINK_SWITCHES) {
    await controls.link(name).click();
    await expect(controls.link(name)).toHaveAttribute("aria-checked", "false");
  }
  await page.reload();
  await expectSettings(page, {
    format: "best compatible",
    bitrate: "128",
    soundcloudCover: false,
    downloadAfterImport: true,
    advanced: true,
    links: false,
  });
});

test("the download format and bitrate choices describe and change the audio tagium saves", async ({
  page,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({ title: "Format Test", audio: "m4a" });
  const converted = await upstreams.youtube.video({ title: "Bitrate Test" });
  await page.goto("/");
  await openSettings(page, "importing");
  await page.getByRole("button", { name: "download format, mp3" }).click();
  const formats = page.getByRole("group", { name: "download format" });
  await expect(formats.getByRole("button")).toHaveText([
    "best compatiblekeeps the original audio without converting it, usually opus from youtube and mp3 from soundcloud.",
    "mp3converts every download to mp3 at the selected bitrate.",
  ]);
  await expect(formats.getByRole("button", { name: /^mp3/u })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("higher bitrates preserve more detail but result in larger files."),
  ).toBeVisible();

  await chooseOption(page, "download format, mp3", "download format", /^best compatible/u);
  await expect(
    page.getByRole("button", { name: "download format, best compatible" }),
  ).toBeVisible();
  await expect(page.getByText("used when a download falls back to mp3.")).toBeVisible();
  await page.getByRole("button", { name: "mp3 bitrate, 320 kbps" }).click();
  await expect(page.getByRole("group", { name: "mp3 bitrate" }).getByRole("button")).toHaveText([
    "320 kbps",
    "256 kbps",
    "128 kbps",
    "96 kbps",
    "64 kbps",
  ]);
  await page
    .getByRole("group", { name: "mp3 bitrate" })
    .getByRole("button", { name: "96 kbps" })
    .click();
  await expect(page.getByRole("button", { name: "mp3 bitrate, 96 kbps" })).toBeVisible();

  await page.getByRole("button", { name: "back to workspace" }).click();
  await startImport(page, video.url);
  const download = page.getByRole("button", { name: "download track" });
  await expect(download).toBeEnabled(IMPORT_TIMEOUT);
  const original = await captureDownload(page, () => download.click());
  expect(original.filename).toBe(savedName("Format Test.m4a"));
  await expectLosslessAudio(original, audioFixture("m4a").file);

  await openSettings(page, "importing");
  await chooseOption(page, "download format, best compatible", "download format", /^mp3/u);
  await page.getByRole("button", { name: "back to workspace" }).click();
  await startImport(page, converted.url);
  await expect(page.getByLabel("title", { exact: true })).toHaveValue("Bitrate Test");
  await expect(download).toBeEnabled(IMPORT_TIMEOUT);
  const mp3 = await captureDownload(page, () => download.click());
  expect(mp3.filename).toBe(savedName("Bitrate Test.mp3"));
  expect((await inspectAudio(mp3)).format).toBe("mp3");
  expect(mp3Bitrate(mp3.bytes)).toBe(96);

  expect(
    (await upstreams.calls({ route: "cobalt.resolve" })).map((call) => {
      const body = JSON.parse(call.requestBody!);
      return [body.url, body.audioFormat, body.audioBitrate];
    }),
  ).toEqual([
    [video.url, "best", "96"],
    [converted.url, "mp3", "96"],
  ]);
});

test("immediate download saves the track as soon as its import finishes", async ({
  page,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({ title: "Instant Save", year: 2022 });
  await page.goto("/");
  await openSettings(page, "importing");
  await settingsControls(page).downloadAfterImport.click();
  await page.getByRole("button", { name: "back to workspace" }).click();

  const saved = await captureDownload(page, () => startImport(page, video.url));
  expect(saved.filename).toBe(savedName("Instant Save.mp3"));
  expect((await inspectAudio(saved)).metadata).toMatchObject({ title: "Instant Save", year: 2022 });
});

test("the soundcloud album cover setting replaces track covers once, at import", async ({
  page,
  upstreams,
}) => {
  const coverSize = async (filename: string) => {
    await page.getByRole("button", { name: filename }).click();
    const download = page.getByRole("button", { name: "download track" });
    await expect(download).toBeEnabled(IMPORT_TIMEOUT);
    const { metadata } = await inspectAudio(await captureDownload(page, () => download.click()));
    expect(metadata.picture).toHaveLength(1);
    return imageSize(new Uint8Array(metadata.picture![0]!.data));
  };
  const albumCover = { width: 64, height: 64 };
  const trackCover = { width: 96, height: 96 };
  const covered = await upstreams.soundcloud.set({
    title: "Covered Set",
    isAlbum: true,
    artwork: "artwork",
    tracks: [{ title: "Album Cover Track", cover: "cover" }],
  });
  const uncovered = await upstreams.soundcloud.set({
    title: "Own Covers Set",
    isAlbum: true,
    artwork: "artwork",
    tracks: [{ title: "Own Cover Track", cover: "cover" }],
  });

  await page.goto("/");
  await startImport(page, covered.url);
  await expect(page.getByRole("button", { name: "1 Album Cover Track.mp3" })).toBeVisible();
  await expect(page.getByRole("button", { name: "download track" })).toBeEnabled(IMPORT_TIMEOUT);
  await openSettings(page, "importing");
  await settingsControls(page).soundcloudCover.click();
  await page.getByRole("button", { name: "back to workspace" }).click();
  await startImport(page, uncovered.url);
  await expect(page.getByRole("button", { name: "1 Own Cover Track.mp3" })).toBeVisible();

  await openSettings(page, "linking");
  await settingsControls(page).link("sync artwork with the album cover").click();
  await page.getByRole("button", { name: "back to workspace" }).click();
  expect(await coverSize("1 Album Cover Track.mp3")).toEqual(albumCover);
  expect(await coverSize("1 Own Cover Track.mp3")).toEqual(trackCover);
});

test("link switches decide which track fields follow their source", async ({ page, upstreams }) => {
  const playlist = await upstreams.youtube.playlist({
    title: "Linked Album",
    author: "Linker",
    videos: [{ title: "Linked Song", year: 2015 }],
  });
  const loose = await upstreams.youtube.video({ title: "Loose Song" });
  await page.goto("/");
  await startImport(page, playlist.url);
  await startImport(page, loose.url);
  await expect(
    page.getByRole("button", { name: "track actions for Loose Song.mp3" }),
  ).toBeVisible();

  const field = (name: string) => page.getByLabel(name, { exact: true });
  await expect(field("album")).toBeDisabled();
  await expect(page.getByText("album is synced with the track title.")).toBeVisible();
  await expect(field("filename")).not.toBeAttached();

  await page.getByRole("button", { name: "1 Linked Song.mp3" }).click();
  await expect(field("title")).toHaveValue("Linked Song");
  for (const name of ["artist", "year", "genre", "track", "album"]) {
    await expect(field(name), name).toBeDisabled();
  }
  await expect(field("artist")).toHaveValue("Linker");
  await expect(field("year")).toHaveValue("2015");
  await expect(page.getByRole("button", { name: "cover linked" })).toBeDisabled();

  await openSettings(page, "linking");
  await expect(
    page.getByText(
      "linked fields are synced with their source. unlink a field to allow it to be freely edited.",
    ),
  ).toBeVisible();
  for (const name of LINK_SWITCHES.slice(0, -1)) {
    await settingsControls(page).link(name).click();
  }
  await page.getByRole("button", { name: "back to workspace" }).click();

  for (const name of ["artist", "year", "genre", "track"]) {
    await expect(field(name), name).toBeEnabled();
  }
  await expect(page.getByRole("button", { name: "upload cover" })).toBeEnabled();
  await field("artist").fill("Solo Artist");
  await field("track").fill("7");
  await field("filename").fill("custom-name");
  await field("title").fill("Renamed Song");
  const download = page.getByRole("button", { name: "download track" });
  await expect(download).toBeEnabled(IMPORT_TIMEOUT);
  const saved = await captureDownload(page, () => download.click());
  expect(saved.filename).toBe(savedName("custom-name.mp3"));
  expect((await inspectAudio(saved)).metadata).toMatchObject({
    title: "Renamed Song",
    artist: "Solo Artist",
    album: "Linked Album",
    trackNumber: 7,
  });

  await page.getByRole("button", { name: "Loose Song.mp3", exact: true }).click();
  await expect(field("album")).toBeEnabled();
});

test("advanced fields are gated by settings and keep their values while hidden", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([audioFixture("mp3").upload]);
  await expect(page.getByLabel("title", { exact: true })).toHaveValue("Fixture Tone (mp3)");
  await expect(page.getByRole("group", { name: "metadata fields" })).not.toBeAttached();

  await openSettings(page, "editing");
  await expect(
    page.getByText(
      "adds album artist, disc number, composer, bpm, and comments to the track editor.",
    ),
  ).toBeVisible();
  const advanced = settingsControls(page).advanced;
  await advanced.click();
  await openSettings(page, "linking");
  await expect(
    settingsControls(page).link("sync album artist with the track artist"),
  ).toBeVisible();
  await page.getByRole("button", { name: "back to workspace" }).click();

  await page.getByRole("button", { name: "advanced", exact: true }).click();
  await page.getByLabel("composer", { exact: true }).fill("Retained Composer");
  await page.getByLabel("disc number", { exact: true }).fill("0");
  await page.getByRole("button", { name: "normal", exact: true }).click();
  await page.getByRole("button", { name: "download track" }).click();
  await expect(page.getByRole("button", { name: "advanced", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("disc number", { exact: true })).toBeFocused();
  await expect(page.getByText("disc number must be a whole number from 1 to 999.")).toBeVisible();
  await page.getByLabel("disc number", { exact: true }).fill("");

  await openSettings(page, "editing");
  await advanced.click();
  await page.getByRole("button", { name: "back to workspace" }).click();
  await expect(page.getByRole("group", { name: "metadata fields" })).not.toBeAttached();
  await openSettings(page, "editing");
  await advanced.click();
  await page.getByRole("button", { name: "back to workspace" }).click();
  await page.getByRole("button", { name: "advanced", exact: true }).click();
  await expect(page.getByLabel("composer", { exact: true })).toHaveValue("Retained Composer");

  const saved = await captureDownload(page, () =>
    page.getByRole("button", { name: "download track" }).click(),
  );
  expect((await inspectAudio(saved)).metadata).toMatchObject({ composer: "Retained Composer" });
});

test("the theme follows the system preference until it is switched by hand", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveClass(/(^|\s)dark(\s|$)/u);
  await page.getByRole("button", { name: "switch to light mode" }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(root).not.toHaveClass(/(^|\s)dark(\s|$)/u);
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe("light");

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("button", { name: "switch to dark mode" })).toBeVisible();

  await page.evaluate((key) => localStorage.removeItem(key), THEME_STORAGE_KEY);
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "switch to dark mode" }).click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(root).toHaveClass(/(^|\s)dark(\s|$)/u);
  await expect(page.getByRole("button", { name: "switch to light mode" })).toBeVisible();
});

test("the about section credits cobalt and links to the project", async ({ page }) => {
  await page.goto("/");
  const about = await openSettings(page, "about");
  for (const heading of ["about", "ethics", "acknowledgements"]) {
    await expect(about.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
  await expect(
    about.getByText("tagium exists to make device-local music more accessible to everyone."),
  ).toBeVisible();
  await expect(about.getByRole("link", { name: "cobalt" })).toHaveAttribute(
    "href",
    "https://cobalt.tools/",
  );
  await expect(about.getByRole("link", { name: "imput" })).toHaveAttribute(
    "href",
    "https://imput.net/",
  );
  const social = about.getByRole("navigation", { name: "social links" });
  await expect(social.getByRole("link", { name: "github" })).toHaveAttribute(
    "href",
    "https://github.com/flamboh/tagium",
  );
  await expect(social.getByRole("link", { name: "twitter" })).toHaveAttribute(
    "href",
    "https://x.com/flambohh",
  );
});
