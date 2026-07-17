// Throwaway design-iteration screenshot helper (not shipped).
// Usage: node scripts/design-shot.mjs <out-prefix>
import { chromium } from "@playwright/test";
import { Buffer } from "node:buffer";

const prefix = process.argv[2] ?? "shot";
const mode = process.env.THEME; // "light" | "dark"
const accentA = process.env.ACCENT_A; // optional hex
const accentB = process.env.ACCENT_B; // optional hex
const base = process.env.APP_URL ?? "http://localhost:3000";
const out = (name) => `/tmp/tagium-shots/${prefix}-${name}.png`;

const mp3 = (name) => {
  const bytes = new Uint8Array(834);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 0);
  bytes.set([0xff, 0xfb, 0x90, 0x00], 417);
  return { name, mimeType: "audio/mpeg", buffer: Buffer.from(bytes) };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
if (mode || accentA || accentB) {
  await page.addInitScript(
    (seed) => {
      const key = "tagium:app-settings";
      let settings = {};
      try {
        settings = JSON.parse(localStorage.getItem(key) ?? "{}");
      } catch {
        settings = {};
      }
      localStorage.setItem(key, JSON.stringify({ ...settings, ...seed }));
    },
    {
      ...(mode ? { mode } : {}),
      ...(accentA ? { accentA } : {}),
      ...(accentB ? { accentB } : {}),
    },
  );
}
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
await page.screenshot({ path: out("landing") });

await page
  .locator('input[type="file"]')
  .first()
  .setInputFiles([
    mp3("Midnight Interlude.mp3"),
    mp3("Glass Harbor.mp3"),
    mp3("Copper Wire.mp3"),
    mp3("Slow Static.mp3"),
  ]);
await page.getByRole("button", { name: "remove track" }).first().waitFor();
await page.waitForTimeout(600);
await page.screenshot({ path: out("editor") });

const settings = page.getByRole("button", { name: /settings/i }).first();
if (await settings.count()) {
  await settings.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: out("settings") });
}

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.screenshot({ path: out("mobile"), fullPage: true });

await browser.close();
console.log("done");
