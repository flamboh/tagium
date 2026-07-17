import { describe, expect, it } from "vite-plus/test";
import { isValidFilenameBase, sanitizeFilenameBase } from "@/features/library/filename";

describe("track filenames", () => {
  it.each(["", " ", "\n\t"])('rejects an empty filename after trimming: "%s"', (value) => {
    expect(sanitizeFilenameBase(value)).toBe("");
    expect(isValidFilenameBase(value)).toBe(false);
  });

  it("quietly sanitizes malformed filename characters", () => {
    expect(sanitizeFilenameBase(" ../mix/name?.mp3 ")).toBe("-mix-name-.mp3");
    expect(isValidFilenameBase(" ../mix/name?.mp3 ")).toBe(true);
  });
});
