import type { Page } from "@playwright/test";
import { captureDownload } from "../support/audio";
import { expect, IMPORT_TIMEOUT } from "../support/test";

export const SAVE_PATH = "/?app=tagium-save";

export type SaveSettings = {
  mode?: "auto" | "audio" | "mute";
  quality?: "1080" | "720" | "480";
  container?: "mp4" | "webm" | "mkv";
  codec?: "h264" | "vp9" | "av1";
  audio?: "best" | "opus" | "mp3";
};

export const suggestedFilename = (page: Page, filename: string) =>
  page.context().browser()?.browserType().name() === "webkit"
    ? filename.replaceAll(" ", "_")
    : filename;

export const saveApp = (page: Page) => {
  const recent = page.getByRole("list", { name: "recent downloads" });
  const app = {
    url: page.getByRole("textbox", { name: "media url" }),
    submit: page.getByRole("button", { name: "start video download" }),
    settings: page.getByRole("button", { name: "download settings", exact: true }),
    progress: page.getByRole("progressbar", { name: "download progress" }),
    cancel: page.getByRole("button", { name: "cancel download" }),
    retry: page.getByRole("button", { name: "retry download" }),
    reset: page.getByRole("button", { name: "reset download" }),
    alert: page.getByRole("alert"),
    recent,
    rows: recent.getByRole("listitem"),
    downloadButton: (filename: string) =>
      recent.getByRole("button", { name: `download ${filename}`, exact: true }),
    async open() {
      await page.goto(SAVE_PATH);
      await expect(app.url).toBeEditable();
    },
    async configure(settings: SaveSettings) {
      await app.settings.click();
      const labels = {
        mode: "mode",
        quality: "quality",
        container: "container",
        codec: "codec",
        audio: "audio",
      } as const;
      for (const [key, value] of Object.entries(settings) as [keyof SaveSettings, string][]) {
        await page.getByLabel(labels[key], { exact: true }).selectOption(value);
      }
      await page.keyboard.press("Escape");
      await expect(page.getByLabel("mode", { exact: true })).toBeHidden();
    },
    async start(url: string) {
      await app.url.fill(url);
      await app.submit.click();
    },
    async save(url: string, filename: string) {
      await app.start(url);
      await expect(app.downloadButton(filename).first()).toBeVisible(IMPORT_TIMEOUT);
    },
    async download(filename: string, index = 0) {
      const file = await captureDownload(page, () =>
        app.downloadButton(filename).nth(index).click(),
      );
      expect(file.filename).toBe(suggestedFilename(page, filename));
      return { ...file, filename };
    },
  };
  return app;
};
