import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, BrowserContext, Locator, Page } from "@playwright/test";
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
} from "../../../src/features/settings/settings";
import type { AppSettings } from "../../../src/features/library/types";
import type { AlbumManifest, Manifest } from "../../../src/features/share/shareManifest";
import { imageFixtures, type ImageFixtureName } from "../fixtures/catalog.ts";
import { expect, IMPORT_TIMEOUT, test } from "../support/test";
import type { FakeYouTubeVideo, Upstreams, YouTubeVideoOptions } from "../support/upstreams";

export const SHARE_URL = /^http:\/\/127\.0\.0\.1:\d+\/share\/[23456789abcdefghjkmnpqrstvwxyz]{6}$/u;
export const RECEIPTS_KEY = "tagium.share-revocations.v1";

export const randomIp = () =>
  `2001:db8::${randomBytes(6).toString("hex").match(/.{4}/gu)!.join(":")}`;

export const slugOf = (url: string) => new URL(url).pathname.split("/").at(-1)!;

export const imageBytes = (name: ImageFixtureName) =>
  new Uint8Array(
    readFileSync(
      fileURLToPath(new URL(`../fixtures/${imageFixtures[name].file}`, import.meta.url)),
    ),
  );

export const seedSettings = (context: BrowserContext, settings: Partial<AppSettings>) =>
  context.addInitScript(
    ({ key, value }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    {
      key: APP_SETTINGS_STORAGE_KEY,
      value: JSON.stringify({ ...DEFAULT_APP_SETTINGS, ...settings }),
    },
  );

export const startImport = async (page: Page, url: string) => {
  await page.getByRole("textbox", { name: "media url" }).fill(url);
  await page.getByRole("button", { name: "start media import" }).click();
};

export const albumMenu = async (page: Page, title: string) => {
  await page.getByRole("button", { name: `album actions for ${title}` }).click();
  return page.getByRole("menu", { name: `album actions for ${title}` });
};

export const trackMenu = async (page: Page, filename: string | RegExp) => {
  const name = typeof filename === "string" ? `track actions for ${filename}` : filename;
  await page.getByRole("button", { name }).click();
  return page.getByRole("menu", { name });
};

export const importAlbum = async (
  page: Page,
  upstreams: Upstreams,
  options: { title: string; author?: string; videos: YouTubeVideoOptions[] },
) => {
  const playlist = await upstreams.youtube.playlist(options);
  await page.goto("/");
  await startImport(page, playlist.url);
  await expect(
    page.getByRole("button", { name: `album actions for ${options.title}` }),
  ).toBeVisible(IMPORT_TIMEOUT);
  return playlist;
};

export const openShareDialog = async (page: Page, title: string) => {
  const menu = await albumMenu(page, title);
  await menu.getByRole("menuitem", { name: "share album", exact: true }).click(IMPORT_TIMEOUT);
  return page.getByRole("dialog", { name: `share album: ${title}` });
};

export const publishAlbum = async (page: Page, title: string) => {
  const dialog = await openShareDialog(page, title);
  await dialog.getByRole("button", { name: "create share link" }).click();
  const link = dialog.getByRole("textbox", { name: "share link" });
  await expect(link).toHaveValue(SHARE_URL);
  return { dialog, url: await link.inputValue() };
};

export const albumManifest = (options: {
  title: string;
  artist: string;
  artwork?: "image/jpeg" | "image/png";
  tracks: { video: FakeYouTubeVideo; title?: string }[];
}): AlbumManifest => {
  const album: AlbumManifest["album"] = { title: options.title, artist: options.artist, genre: "" };
  const manifest: AlbumManifest = {
    version: 1,
    kind: "album",
    album: options.artwork
      ? { ...album, artwork: { kind: "stored", format: options.artwork, type: 3, description: "" } }
      : album,
    tracks: options.tracks.map((track, index) => ({
      sourceUrl: track.video.url,
      audioBitrate: "320",
      metadata: {
        filename: track.title ?? track.video.title,
        title: track.title ?? track.video.title,
        artist: options.artist,
        album: options.title,
        genre: "",
        trackNumber: index + 1,
      },
    })),
  };
  return manifest;
};

export type CreatedShare = {
  slug: string;
  url: string;
  expiresAt: string | null;
  revocationToken: string;
  analyticsId: string;
};

export const coverUpload = (name: ImageFixtureName) => ({
  name: imageFixtures[name].file,
  mimeType: imageFixtures[name].mime,
  buffer: Buffer.from(imageBytes(name)),
});

export const createShare = async (
  request: APIRequestContext,
  manifest: Manifest,
  cover?: ImageFixtureName,
): Promise<CreatedShare> => {
  const response = await request.post("/api/manifests", {
    headers: { Accept: "application/json" },
    multipart: cover
      ? { manifest: JSON.stringify(manifest), cover: coverUpload(cover) }
      : { manifest: JSON.stringify(manifest) },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as CreatedShare;
};

export const seedReceipt = (context: BrowserContext, share: CreatedShare) =>
  context.addInitScript(
    ({ key, value }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    {
      key: RECEIPTS_KEY,
      value: JSON.stringify([
        { slug: share.slug, expiresAt: share.expiresAt, token: share.revocationToken },
      ]),
    },
  );

export const storedReceipts = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]") as unknown[], RECEIPTS_KEY);

export const notifications = (page: Page) => page.getByRole("region", { name: /notifications/iu });

export const dragOnto = async (page: Page, source: Locator, target: Locator) => {
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
  await expect(target).toBeVisible();
  await page.mouse.up();
};

declare global {
  interface Window {
    e2eCopiedText?: string[];
  }
}

export const stubClipboard = async (context: BrowserContext) => {
  await context.addInitScript(() => {
    const copied: string[] = [];
    Object.defineProperty(window, "e2eCopiedText", { value: copied });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (localStorage.getItem("e2e-clipboard") === "deny") throw new Error("denied");
          copied.push(text);
        },
      },
    });
  });
  return {
    copied: (page: Page) => page.evaluate(() => window.e2eCopiedText ?? []),
    deny: (page: Page) => page.evaluate(() => localStorage.setItem("e2e-clipboard", "deny")),
  };
};

export const savedName = (name: string) =>
  test.info().project.name === "webkit" ? name.replaceAll(" ", "_") : name;

export const IMPORT_HEAVY = { timeout: 150_000 };
