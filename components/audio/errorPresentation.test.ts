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

  it("centers the filename independently from the fixed error margin", () => {
    expect(trackMetadataEditorSource).toContain('className="flex h-full min-w-0 items-center"');
    expect(trackMetadataEditorSource).toContain(
      'className="absolute inset-x-4 bottom-1 h-4 min-w-0 overflow-hidden',
    );
  });

  it("keeps cover validation state separate from tooltip visibility", () => {
    expect(coverArtSource).toContain("onOpenChange={setCoverErrorOpen}");
    expect(coverArtSource).toContain("aria-describedby={coverError ? coverErrorId : undefined}");
    expect(coverArtSource).not.toContain("if (!open) setCoverError(null)");
  });
});
