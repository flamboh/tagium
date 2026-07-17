import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build } from "vite";

const OUTPUT_DIR = "/tmp/tagium-flac-alternative-smoke";
const ENTRY_PATH = `${OUTPUT_DIR}/entry.ts`;
const FIXTURE_PATH = `${OUTPUT_DIR}/fixture.flac`;
const BUNDLE_PATH = `${OUTPUT_DIR}/dist/smoke.js`;

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

await mkdir(OUTPUT_DIR, { recursive: true });
await writeFile(
  ENTRY_PATH,
  `import { writeMetadata } from "@akabeko/music-metadata-editor";\n` +
    `export const smoke = (bytes: Uint8Array) => writeMetadata(bytes, { tag: { title: "Browser smoke" } });\n`,
);

const ffmpeg = spawnSync(
  "ffmpeg",
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100:duration=1",
    "-ac",
    "2",
    "-c:a",
    "flac",
    "-y",
    FIXTURE_PATH,
  ],
  { encoding: "utf8" },
);
assert(ffmpeg.status === 0, ffmpeg.stderr || "failed to generate FLAC smoke fixture");

await build({
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: {
      "@akabeko/music-metadata-editor": fileURLToPath(
        new URL("../node_modules/@akabeko/music-metadata-editor/dist/mme.js", import.meta.url),
      ),
    },
  },
  build: {
    outDir: `${OUTPUT_DIR}/dist`,
    emptyOutDir: true,
    lib: { entry: ENTRY_PATH, formats: ["es"], fileName: "smoke" },
    minify: false,
  },
});

const bundle = await readFile(BUNDLE_PATH);
const fixture = await readFile(FIXTURE_PATH);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.route("http://smoke.test/**", async (route) => {
  const url = route.request().url();
  if (url.endsWith("smoke.js")) {
    await route.fulfill({ status: 200, contentType: "text/javascript", body: bundle });
  } else if (url.endsWith("fixture.flac")) {
    await route.fulfill({ status: 200, contentType: "audio/flac", body: fixture });
  } else {
    await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" });
  }
});

try {
  await page.goto("http://smoke.test/");
  const result = await page.evaluate(async () => {
    try {
      const modulePath = "/smoke.js";
      const module = (await import(modulePath)) as {
        smoke: (bytes: Uint8Array) => Promise<Uint8Array>;
      };
      const bytes = new Uint8Array(await (await fetch("/fixture.flac")).arrayBuffer());
      const output = await module.smoke(bytes);
      return { ok: true as const, outputBytes: output.length };
    } catch (error) {
      return { ok: false as const, error: String(error) };
    }
  });

  assert(
    !result.ok,
    "alternative unexpectedly became browser-ready; run its full preservation gate",
  );
  assert(
    result.error.includes("reading 'from'") || result.error.includes("Buffer"),
    `unexpected browser failure: ${result.error}`,
  );
  console.log(
    JSON.stringify(
      {
        candidate: "@akabeko/music-metadata-editor@1.0.1",
        viteBundleCompleted: true,
        bundleBytes: bundle.length,
        chromiumWriteCompleted: false,
        observedError: result.error,
        interpretation:
          "The published entry is not browser-ready in vanilla Vite; polyfilled/custom builds remain untested.",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
