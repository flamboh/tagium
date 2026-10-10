import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Page, Route } from "@playwright/test";
import { audioFixtures, type AudioFixtureName } from "../fixtures/catalog.ts";
import type { DownloadedFile } from "../support/audio";
import type { Upstreams } from "../support/upstreams";
import { expect, IMPORT_TIMEOUT } from "../support/test";
import {
  APP_SETTINGS_STORAGE_KEY,
  DEFAULT_APP_SETTINGS,
} from "../../../src/features/settings/settings";
import type { AppSettings } from "../../../src/features/library/types";

export { expect, SETTLE_TIMEOUT } from "../support/test";

export const importUrl = async (page: Page, url: string) => {
  const submit = page.getByRole("button", { name: "start media import" });
  await expect(submit).not.toHaveAttribute("aria-busy", "true", IMPORT_TIMEOUT);
  await page.getByRole("textbox", { name: "media url" }).fill(url);
  await submit.click();
};

export const field = (page: Page, name: "title" | "artist" | "album" | "genre") =>
  page.getByRole("textbox", { name, exact: true });

export const numberField = (page: Page, name: "year" | "track") =>
  page.getByRole("spinbutton", { name, exact: true });

export const downloadTrackButton = (page: Page) =>
  page.getByRole("button", { name: "download track", exact: true });

export const waitForTrackReady = (page: Page) =>
  expect(downloadTrackButton(page)).toBeEnabled(IMPORT_TIMEOUT);

export const audioPreview = (page: Page) => page.getByRole("region", { name: "audio preview" });

export const notifications = (page: Page) => page.getByRole("region", { name: /^notifications/u });

export const queueStatus = (page: Page, text: string) => page.getByText(text, { exact: true });

export const useSettings = async (context: BrowserContext, settings: Partial<AppSettings>) => {
  await context.addInitScript(
    ({ key, value }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
    },
    {
      key: APP_SETTINGS_STORAGE_KEY,
      value: JSON.stringify({ ...DEFAULT_APP_SETTINGS, ...settings }),
    },
  );
};

export const streamFixture = (name: AudioFixtureName): DownloadedFile => {
  const file = audioFixtures[name].stream;
  return {
    filename: file,
    bytes: new Uint8Array(
      readFileSync(fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url))),
    ),
  };
};

export const cobaltRequests = async (upstreams: Upstreams) =>
  (await upstreams.calls({ route: "cobalt.resolve" })).map(
    (call) =>
      JSON.parse(call.requestBody!) as {
        url: string;
        audioFormat: string;
        audioBitrate: string;
      },
  );

export const cobaltRequestCount = async (upstreams: Upstreams, url: string) =>
  (await cobaltRequests(upstreams)).filter((request) => request.url === url).length;

export const removeTrack = async (page: Page, filename: string) => {
  await page.getByRole("button", { name: `track actions for ${filename}` }).click();
  await page.getByRole("menuitem", { name: "remove track" }).click();
  await page
    .getByRole("dialog", { name: "remove track?" })
    .getByRole("button", { name: "remove track" })
    .click();
};

export const holdDownloadPlans = async (page: Page) => {
  const held: { url: string; route: Route }[] = [];
  const requested: { url: string; year?: number }[] = [];
  let holding = true;
  const forward = (route: Route) => route.continue().catch(() => {});
  await page.route("**/api/cobalt/audio", async (route) => {
    const body = route.request().postDataJSON() as { url: string; year?: number };
    const { url } = body;
    requested.push(body);
    if (holding) held.push({ url, route });
    else await forward(route);
  });
  return {
    requested: () => requested.map(({ url }) => url),
    years: () => requested.map(({ year }) => year),
    releaseAll: async () => {
      holding = false;
      await Promise.all(held.splice(0).map(({ route }) => forward(route)));
    },
  };
};

const MPEG1_LAYER3_KBPS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];

export const mp3BitrateKbps = (bytes: Uint8Array) => {
  let offset = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    offset = 10 + ((bytes[6]! << 21) | (bytes[7]! << 14) | (bytes[8]! << 7) | bytes[9]!);
  }
  while (offset < bytes.length - 4) {
    if (bytes[offset] === 0xff && (bytes[offset + 1]! & 0xfe) === 0xfa) {
      return MPEG1_LAYER3_KBPS[bytes[offset + 2]! >> 4];
    }
    offset += 1;
  }
  return undefined;
};

export const imageSize = (bytes: Uint8Array) => {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  let offset = 2;
  while (offset < bytes.length - 9) {
    const marker = bytes[offset + 1]!;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      };
    }
    offset += 2 + length;
  }
  return undefined;
};

export const savedAs = (browserName: string, filename: string) =>
  browserName === "webkit" ? filename.replaceAll(" ", "_") : filename;
