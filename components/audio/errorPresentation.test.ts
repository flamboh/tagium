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

  it("keeps cover validation state separate from tooltip visibility", () => {
    expect(coverArtSource).toContain("onOpenChange={setCoverErrorOpen}");
    expect(coverArtSource).toContain("aria-describedby={coverError ? coverErrorId : undefined}");
    expect(coverArtSource).not.toContain("if (!open) setCoverError(null)");
  });
});
