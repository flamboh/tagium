import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inspectAudio } from "../support/audio";
import { expect, SETTLE_TIMEOUT, test } from "../support/test";
import {
  backToWorkspace,
  downloadTrack,
  editorMode,
  field,
  numberField,
  pickFiles,
  seedSettings,
  type Upload,
} from "./workspace";

// 24 seconds of a 128 bpm kick under an A minor chord (see ../fixtures/README.md).
const djFixture = (format: "mp3" | "m4a"): Upload => ({
  name: `dj-analysis.${format}`,
  mimeType: format === "mp3" ? "audio/mpeg" : "audio/mp4",
  buffer: Buffer.from(
    readFileSync(fileURLToPath(new URL(`../fixtures/dj-analysis.${format}`, import.meta.url))),
  ),
});

const alternateKey = (page: import("@playwright/test").Page) =>
  page.locator("[data-key-alternate]");

for (const format of ["mp3", "m4a"] as const) {
  test(`detects and tags the tempo and key of an imported ${format} track`, async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit" && format === "m4a",
      "playwright's macos webkit build cannot decode aac, so there is nothing to analyze",
    );
    await seedSettings(page, { djAnalysis: true, keyNotation: "both" });
    await page.goto("/");
    await pickFiles(page, [djFixture(format)]);

    await expect(numberField(page, "bpm")).toHaveValue("128", SETTLE_TIMEOUT);
    await expect(field(page, "key")).toHaveValue("Am");
    await expect(alternateKey(page)).toHaveText("camelot notation 8A");

    const { metadata } = await inspectAudio(await downloadTrack(page));
    expect(metadata).toMatchObject({ title: "dj fixture", bpm: 128, musicalKey: "Am" });
  });
}

test("tags camelot codes and keeps a tempo typed over the detected one", async ({ page }) => {
  await seedSettings(page, { djAnalysis: true, keyNotation: "camelot", advancedMetadata: true });
  await page.goto("/");
  await pickFiles(page, [djFixture("mp3")]);

  await expect(field(page, "key")).toHaveValue("8A", SETTLE_TIMEOUT);
  await expect(alternateKey(page)).toHaveCount(0);
  await numberField(page, "bpm").fill("64");

  // the dj row stays put, and is not duplicated, when the advanced fields are showing.
  await editorMode(page, "advanced").click();
  await expect(numberField(page, "bpm")).toHaveCount(1);
  await expect(numberField(page, "bpm")).toHaveValue("64");

  const { metadata } = await inspectAudio(await downloadTrack(page));
  expect(metadata).toMatchObject({ bpm: 64, musicalKey: "8A" });
});

test("leaves tracks untouched until dj analysis is turned on in settings", async ({ page }) => {
  await page.goto("/");
  await pickFiles(page, [djFixture("mp3")]);
  await expect(field(page, "title")).toHaveValue("dj fixture");
  await expect(numberField(page, "bpm")).toHaveCount(0);

  const { metadata: untouched } = await inspectAudio(await downloadTrack(page));
  expect(untouched).toMatchObject({ bpm: null, musicalKey: "" });

  await page.getByRole("button", { name: "settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "settings sections" })
    .getByRole("button", { name: "editing", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /^key notation, / })).toBeDisabled();
  await page.getByRole("checkbox", { name: /^detect bpm and key/u }).click();
  await page.getByRole("button", { name: /^key notation, standard$/u }).click();
  await page
    .getByRole("group", { name: "key notation" })
    .getByRole("button", { name: /^standard and camelot/u })
    .click();
  await backToWorkspace(page);

  await expect(numberField(page, "bpm")).toHaveValue("128", SETTLE_TIMEOUT);
  await expect(field(page, "key")).toHaveValue("Am");
  await expect(alternateKey(page)).toHaveText("camelot notation 8A");

  await page.reload();
  await page.getByRole("button", { name: "settings", exact: true }).click();
  await page
    .getByRole("navigation", { name: "settings sections" })
    .getByRole("button", { name: "editing", exact: true })
    .click();
  await expect(page.getByRole("checkbox", { name: /^detect bpm and key/u })).toBeChecked();
  await expect(
    page.getByRole("button", { name: "key notation, standard and camelot" }),
  ).toBeVisible();
});
