import { describe, expect, it } from "vite-plus/test";
import coverArtSource from "@/features/editor/coverArt.tsx?raw";
import trackMetadataEditorSource from "@/features/editor/TrackMetadataEditor.tsx?raw";

describe("local error presentation", () => {
  it("associates the synced title error with its input", () => {
    expect(trackMetadataEditorSource).toContain(
      'syncFilenames && filenameInvalid ? "track-filename-error" : undefined',
    );
  });

  it("keeps an empty filename visible when a durable track failure also exists", () => {
    expect(trackMetadataEditorSource).toContain("{filenameInvalid ? (");
    expect(trackMetadataEditorSource).toContain("track error");
    expect(trackMetadataEditorSource).not.toContain(
      'id="track-filename-error" className="sr-only"',
    );
  });

  it("keeps cover validation state separate from tooltip visibility", () => {
    expect(coverArtSource).toContain(
      'onOpenChange={(open) => dispatch({ type: "errorOpenChanged", open })}',
    );
    expect(coverArtSource).toContain("coverError ? coverErrorId : null");
    expect(coverArtSource).toContain("disabled && disabledReason ? disabledReasonId : null");
  });
});
