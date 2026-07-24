import { describe, expect, it } from "vite-plus/test";
import coverArtSource from "@/features/editor/coverArt.tsx?raw";
import trackMetadataEditorSource from "@/features/editor/TrackMetadataEditor.tsx?raw";

describe("local error presentation", () => {
  it("associates every track field label with its input", () => {
    for (const id of [
      "track-title",
      "track-artist",
      "track-album",
      "track-year",
      "track-genre",
      "track-number",
      "track-album-artist",
      "track-disc-number",
      "track-bpm",
      "track-composer",
      "track-comment",
    ]) {
      expect(trackMetadataEditorSource).toContain(`<label htmlFor="${id}"`);
      expect(trackMetadataEditorSource).toContain(`id="${id}"`);
    }

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

  it("centers the filename independently from the fixed error margin", () => {
    expect(trackMetadataEditorSource).toContain(
      'className="flex h-full min-w-0 items-center justify-between gap-3"',
    );
    expect(trackMetadataEditorSource).toContain(
      'className="absolute inset-x-4 bottom-1 h-4 min-w-0 overflow-hidden',
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
