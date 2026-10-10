import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { expectLosslessAudio, inspectAudio } from "../support/audio";
import { expect, test } from "../support/test";
import { downloadTrack, editorMode, field, pickFiles, seedSettings } from "./workspace";

for (const format of ["flac", "opus"] as const) {
  test(`editing the displayed ${format} comment preserves a separate description`, async ({
    page,
  }) => {
    const filename = `separate-description.${format}`;
    const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/${filename}`, import.meta.url)));
    await seedSettings(page, { advancedMetadata: true });
    await page.goto("/");
    await pickFiles(page, [
      {
        name: filename,
        mimeType: format === "flac" ? "audio/flac" : "audio/ogg",
        buffer: Buffer.from(bytes),
      },
    ]);
    await expect(field(page, "title")).toHaveValue("Comment preservation");
    await editorMode(page, "advanced").click();
    await expect(field(page, "comment")).toHaveValue("Primary comment");
    await field(page, "comment").fill("Updated comment");
    const exported = await downloadTrack(page);
    expect((await inspectAudio(exported)).metadata.comment).toBe("Updated comment");
    expect(Buffer.from(exported.bytes).includes("DESCRIPTION=Separate description")).toBe(true);
    expect(Buffer.from(exported.bytes).includes("Primary comment")).toBe(false);
    await expectLosslessAudio(exported, { filename, bytes });
    await field(page, "comment").fill("");
    const cleared = await downloadTrack(page);
    expect(Buffer.from(cleared.bytes).includes("DESCRIPTION=Separate description")).toBe(true);
    expect(Buffer.from(cleared.bytes).includes("COMMENT=Updated comment")).toBe(false);
    await expectLosslessAudio(cleared, { filename, bytes });
  });
}
