import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vite-plus/test";
import { TooltipProvider } from "@/components/ui/tooltip";
import TrackMetadataEditor from "@/features/editor/TrackMetadataEditor";
import type { AudioMetadata, TagiumFile } from "@/features/library/types";

const metadata: AudioMetadata = {
  filename: "",
  title: "",
  artist: "",
  album: "",
  year: null,
  genre: "",
  duration: 125,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: null,
};

const loadedTrack: TagiumFile = {
  id: "track-1",
  filename: "track-1.mp3",
  status: "saved",
  downloadStatus: "ready",
  metadata,
};

function EditorHarness({
  selectedFile = loadedTrack,
  syncFilenames = true,
}: {
  selectedFile?: TagiumFile | null;
  syncFilenames?: boolean;
}) {
  const { register, control, handleSubmit } = useForm<AudioMetadata>({
    defaultValues: metadata,
  });

  return (
    <TooltipProvider>
      <TrackMetadataEditor
        selectedFile={selectedFile}
        selectedFileId={selectedFile?.id ?? null}
        register={register}
        control={control}
        handleSubmit={handleSubmit}
        onTrackCoverUpload={vi.fn()}
        onTrackCoverProcessingChange={vi.fn()}
        isTrackCoverProcessing={false}
        onDownloadUpdatedFile={vi.fn()}
        selectedFileAlbum={undefined}
        syncFilenames={syncFilenames}
        syncTrackNumbers
        onPreviewMetadataChange={vi.fn()}
      />
    </TooltipProvider>
  );
}

describe("track metadata editor form seam", () => {
  it("routes an unavailable track to the empty editor state", () => {
    const markup = renderToStaticMarkup(<EditorHarness selectedFile={null} />);

    expect(markup).toContain("select a track to edit its tags");
    expect(markup).not.toContain('id="track-title"');
  });

  it("associates every metadata label with its input", () => {
    const markup = renderToStaticMarkup(<EditorHarness />);

    for (const id of [
      "track-title",
      "track-artist",
      "track-album",
      "track-year",
      "track-genre",
      "track-number",
    ]) {
      expect(markup).toContain(`for="${id}"`);
      expect(markup).toContain(`id="${id}"`);
    }
  });

  it("describes a synced filename error from the title field", () => {
    const markup = renderToStaticMarkup(<EditorHarness />);

    expect(markup).toContain('id="track-filename-error"');
    expect(markup).toContain("filename is required");
    expect(markup).toMatch(
      /id="track-title"[^>]*aria-invalid="true"[^>]*aria-describedby="track-filename-error"/,
    );
  });

  it("describes an independent filename error from the filename input", () => {
    const markup = renderToStaticMarkup(<EditorHarness syncFilenames={false} />);

    expect(markup).toMatch(
      /aria-label="filename"[^>]*aria-invalid="true"[^>]*aria-describedby="track-filename-error"/,
    );
    expect(markup).not.toMatch(/id="track-title"[^>]*aria-describedby=/);
  });
});
