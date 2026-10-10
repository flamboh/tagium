import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import type { AppSettings } from "../../../src/features/library/types";
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
} from "../../../src/features/settings/settings";
import { audioFixtures, type AudioFixtureFormat } from "../fixtures/catalog.ts";
import { captureDownload, type DownloadedFile } from "../support/audio";
import { expect, test } from "../support/test";

export type Upload = { name: string; mimeType: string; buffer: Buffer };

export const formats = ["mp3", "flac", "m4a", "opus"] as const satisfies AudioFixtureFormat[];

const readBytes = (url: URL) => new Uint8Array(readFileSync(fileURLToPath(url)));

const asUpload = (bytes: Uint8Array, name: string, mimeType: string) => ({
  upload: { name, mimeType, buffer: Buffer.from(bytes) } satisfies Upload,
  file: { filename: name, bytes } satisfies DownloadedFile,
});

export const taggedTags = {
  title: (format: AudioFixtureFormat) => `Café 東京 🎵 ${format}`,
  artist: "Björk & 王 🦊",
  album: "Night Signals 🌙",
  albumArtist: "Various Artists 🎼",
  year: 2024,
  genre: "Ambient / 電子",
  trackNumber: 7,
  trackTotal: 12,
  discNumber: 2,
  composer: "Zoë",
  comment: "first line\nsecond line",
} as const;

export const taggedFixture = (format: AudioFixtureFormat, name = `tagged.${format}`) =>
  asUpload(
    readBytes(new URL(`./fixtures/tagged.${format}`, import.meta.url)),
    name,
    audioFixtures[format].mime,
  );

export const waveformFixture = (format: AudioFixtureFormat) =>
  asUpload(
    readBytes(new URL(`../fixtures/waveform.${format}`, import.meta.url)),
    `waveform.${format}`,
    audioFixtures[format].mime,
  );

const wavBytes = () => {
  const bytes = Buffer.alloc(44 + 800);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(800, 40);
  return bytes;
};

export const invalidUploads = {
  text: { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("this is not audio") },
  wav: { name: "voice memo.wav", mimeType: "audio/wav", buffer: wavBytes() },
  corrupt: {
    name: "corrupt.mp3",
    mimeType: "audio/mpeg",
    buffer: Buffer.from("ID3\u0004\u0000\u0000\u007f\u007f\u007f\u007fgarbage", "latin1"),
  },
  empty: { name: "empty.flac", mimeType: "audio/flac", buffer: Buffer.alloc(0) },
} satisfies Record<string, Upload>;

export const unlinkedSettings: Partial<AppSettings> = {
  syncTrackNumbers: false,
  advancedMetadata: true,
  metadataLinks: {
    singleAlbum: false,
    artist: false,
    year: false,
    genre: false,
    artwork: false,
    albumArtist: false,
  },
};

export const seedSettings = (page: Page, settings: Partial<AppSettings>) =>
  page.addInitScript(
    ({ key, value }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    {
      key: APP_SETTINGS_STORAGE_KEY,
      value: JSON.stringify({ ...DEFAULT_APP_SETTINGS, ...settings }),
    },
  );

export const dropzone = (page: Page) =>
  page.getByRole("button", { name: /^(drop your audio here|drop to import)/u });

export const pickFiles = async (page: Page, files: Upload[]) => {
  const chooser = page.waitForEvent("filechooser");
  await dropzone(page).click();
  await (await chooser).setFiles(files);
};

export const dropFiles = async (page: Page, target: Locator, files: Upload[]) => {
  const dataTransfer = await page.evaluateHandle(
    (entries) => {
      const transfer = new DataTransfer();
      for (const entry of entries) {
        const binary = atob(entry.base64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        transfer.items.add(new File([bytes], entry.name, { type: entry.mimeType }));
      }
      return transfer;
    },
    files.map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      base64: file.buffer.toString("base64"),
    })),
  );
  await target.dispatchEvent("dragenter", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
};

export const libraryCount = (page: Page, count: number) =>
  expect(page.getByText(`library (${count})`, { exact: true })).toBeVisible();

export const trackRow = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

export const field = (page: Page, name: string) => page.getByRole("textbox", { name, exact: true });

export const numberField = (page: Page, name: string) =>
  page.getByRole("spinbutton", { name, exact: true });

export const editorMode = (page: Page, mode: "normal" | "advanced") =>
  page.getByRole("group", { name: "metadata fields" }).getByRole("button", { name: mode });

export const downloadTrackButton = (page: Page) =>
  page.getByRole("button", { name: "download track", exact: true });

export const downloadTrack = (page: Page) =>
  captureDownload(page, () => downloadTrackButton(page).click());

export const confirmDownload = async (page: Page, dialogName: string) => {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await expect(dialog).toBeVisible();
  return captureDownload(page, () => dialog.getByRole("button", { name: /^download ~/u }).click());
};

export const downloadAll = async (page: Page, dialogName: string) => {
  await page.getByRole("button", { name: "download all", exact: true }).click();
  return confirmDownload(page, dialogName);
};

export const toast = (page: Page, title: string) =>
  page
    .getByRole("region", { name: /notifications/iu })
    .getByRole("listitem")
    .filter({ hasText: title });

export const openAlbumAction = async (page: Page, album: string, action: string | RegExp) => {
  await page
    .getByRole("button", { name: new RegExp(`^album actions for ${escapeRegExp(album)}`, "u") })
    .click();
  await page.getByRole("menuitem", { name: action }).click();
};

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export const openSettings = async (page: Page, section?: "importing" | "editing" | "linking") => {
  await page.getByRole("button", { name: "settings", exact: true }).click();
  if (section) {
    await page
      .getByRole("navigation", { name: "settings sections" })
      .getByRole("button", { name: section })
      .click();
  }
};

export const backToWorkspace = (page: Page) =>
  page.getByRole("button", { name: "back to workspace" }).click();

export const goHome = (page: Page) =>
  page.getByRole("button", { name: "tagium, go to workspace home" }).click();

export const expectDownloadName = (file: DownloadedFile, name: string) =>
  expect(file.filename).toBe(
    test.info().project.name === "webkit" ? name.replaceAll(" ", "_") : name,
  );
