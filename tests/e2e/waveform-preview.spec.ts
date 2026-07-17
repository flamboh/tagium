import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";

const previewUpload = (name = "waveform-track.mp3") => {
  const bytes = new Uint8Array(834);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 417);
  return {
    name,
    mimeType: "audio/mpeg",
    buffer: Buffer.from(bytes),
  };
};

const installPlayablePreview = async (page: import("@playwright/test").Page) => {
  await page.addInitScript(() => {
    type TestMedia = { dispatchEvent: (event: unknown) => boolean };
    const browser = globalThis as unknown as {
      Event: new (type: string) => unknown;
      HTMLMediaElement: { prototype: TestMedia & Record<string, unknown> };
    };
    const playback = new WeakMap<object, { currentTime: number; paused: boolean }>();
    const stateFor = (media: object) => {
      const existing = playback.get(media);
      if (existing) return existing;
      const created = { currentTime: 0, paused: true };
      playback.set(media, created);
      return created;
    };
    Object.defineProperties(browser.HTMLMediaElement.prototype, {
      currentTime: {
        configurable: true,
        get() {
          return stateFor(this).currentTime;
        },
        set(value: number) {
          stateFor(this).currentTime = value;
        },
      },
      duration: { configurable: true, get: () => 120 },
      paused: {
        configurable: true,
        get() {
          return stateFor(this).paused;
        },
      },
    });
    browser.HTMLMediaElement.prototype.load = function (this: TestMedia) {
      stateFor(this).currentTime = 0;
      queueMicrotask(() => this.dispatchEvent(new browser.Event("loadedmetadata")));
    };
    browser.HTMLMediaElement.prototype.play = function (this: TestMedia) {
      stateFor(this).paused = false;
      this.dispatchEvent(new browser.Event("play"));
      return Promise.resolve();
    };
    browser.HTMLMediaElement.prototype.pause = function (this: TestMedia) {
      stateFor(this).paused = true;
      this.dispatchEvent(new browser.Event("pause"));
    };
    class PlayableAudioContext {
      decodeAudioData() {
        return Promise.resolve({
          duration: 120,
          length: 4,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([0, 0.5, 1, 0.5]),
        });
      }

      close() {
        return Promise.resolve();
      }
    }
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: PlayableAudioContext,
    });
  });
};

const rejectWaveformDecoding = async (page: import("@playwright/test").Page) => {
  await page.addInitScript(() => {
    class UnsupportedAudioContext {
      decodeAudioData() {
        return Promise.reject(new Error("unsupported test audio"));
      }

      close() {
        return Promise.resolve();
      }
    }
    Object.defineProperty(globalThis, "AudioContext", {
      configurable: true,
      value: UnsupportedAudioContext,
    });
  });
};

test("keeps metadata editing available when waveform decoding is unsupported", async ({ page }) => {
  await rejectWaveformDecoding(page);
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(previewUpload());

  const preview = page.getByRole("region", { name: /preview waveform-track/i });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("data-waveform-status", "unavailable");
  await expect(preview.getByText(/waveform unavailable/i)).toBeVisible();

  const title = page.getByLabel("title:");
  await title.fill("still editable");
  await expect(title).toHaveValue("still editable");
  await expect(page.getByRole("button", { name: "download track" })).toBeEnabled();
});

test("plays, seeks, and horizontally pans without blocking editor interaction", async ({
  page,
}) => {
  await installPlayablePreview(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(previewUpload());

  const preview = page.getByRole("region", { name: /preview waveform-track/i });
  await expect(preview).toHaveAttribute("data-waveform-status", "ready");
  await preview.getByRole("button", { name: "play preview" }).click();
  await expect(preview.getByRole("button", { name: "pause preview" })).toBeVisible();
  await preview.getByRole("button", { name: "pause preview" }).click();
  await expect(preview.getByRole("button", { name: "play preview" })).toBeVisible();

  const slider = preview.getByRole("slider", { name: "track position" });
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", "5");

  const bounds = await slider.boundingBox();
  if (!bounds) throw new Error("waveform slider has no bounds");
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(slider).toHaveAttribute("aria-valuenow", "60");
  await slider.dispatchEvent("pointerdown", {
    clientX: bounds.x + bounds.width / 4,
    pointerId: 3,
    pointerType: "touch",
  });
  await slider.dispatchEvent("pointerup", {
    clientX: bounds.x + bounds.width / 4,
    pointerId: 3,
    pointerType: "touch",
  });
  await expect(slider).toHaveAttribute("aria-valuenow", "30");

  const scroller = page.locator("[data-waveform-scroller]");
  await expect(scroller).toBeVisible();
  const scrollLeft = await scroller.evaluate((element) => {
    element.scrollLeft = 120;
    return element.scrollLeft;
  });
  expect(scrollLeft).toBeGreaterThan(0);

  await page.getByLabel("title:").fill("transport remains editable");
  await expect(page.getByLabel("title:")).toHaveValue("transport remains editable");
});
