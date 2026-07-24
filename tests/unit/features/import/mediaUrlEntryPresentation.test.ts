import { describe, expect, it } from "vite-plus/test";
import { getMediaUrlEntryPresentation } from "@/features/import/mediaUrlEntryPresentation";

describe("media URL entry presentation", () => {
  it("unmounts the entry while settings is open", () => {
    expect(getMediaUrlEntryPresentation(true, false)).toEqual({ layout: "landing" });
    expect(getMediaUrlEntryPresentation(true, true)).toBeNull();
    expect(getMediaUrlEntryPresentation(false, true, true)).toBeNull();
  });

  it("uses layout-owned empty and selected editor placements", () => {
    expect(getMediaUrlEntryPresentation(false, false)).toEqual({ layout: "empty-editor" });
    expect(getMediaUrlEntryPresentation(false, false, true)).toEqual({ layout: "editor" });
  });
});
