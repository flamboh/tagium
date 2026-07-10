import { describe, expect, it } from "vite-plus/test";
import coverArtSource from "./coverArt.tsx?raw";
import trackMetadataEditorSource from "./TrackMetadataEditor.tsx?raw";

describe("local error presentation", () => {
  it("keeps an empty filename visible when a durable track failure also exists", () => {
    expect(trackMetadataEditorSource).toContain("{filenameInvalid ? (");
    expect(trackMetadataEditorSource).toContain("track error");
    expect(trackMetadataEditorSource).not.toContain(
      'id="track-filename-error" className="sr-only"',
    );
  });

  it("reserves enough fixed header space for both track-error lines", () => {
    expect(trackMetadataEditorSource).toContain("lg:px-6 lg:py-4");
    expect(trackMetadataEditorSource).toContain(
      'className="h-8 min-w-0 shrink-0 overflow-hidden text-xs leading-4 text-destructive',
    );
  });

  it("keeps cover validation state separate from tooltip visibility", () => {
    expect(coverArtSource).toContain("onOpenChange={setCoverErrorOpen}");
    expect(coverArtSource).toContain("aria-describedby={coverError ? coverErrorId : undefined}");
    expect(coverArtSource).not.toContain("if (!open) setCoverError(null)");
  });
});
