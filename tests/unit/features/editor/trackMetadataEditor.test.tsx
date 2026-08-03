import { renderToStaticMarkup } from "react-dom/server";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vite-plus/test";
import { TooltipProvider } from "@/components/ui/tooltip";
import TrackMetadataEditor, {
  MetadataEditorModeToggle,
} from "@/features/editor/TrackMetadataEditor";
import { getMetadataLinkDescriptor } from "@/features/library/metadataLinks";
import type { AudioMetadata, TagiumFile } from "@/features/library/types";

const metadata: AudioMetadata = {
  filename: "",
  title: "",
  artist: "",
  albumArtist: "",
  album: "",
  year: null,
  genre: "",
  duration: 125,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: null,
  composer: "",
  comment: "",
  discNumber: null,
  bpm: null,
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
  const { register, control, getValues, setError, clearErrors, setFocus } = useForm<AudioMetadata>({
    defaultValues: metadata,
  });

  return (
    <TooltipProvider>
      <TrackMetadataEditor
        selectedFile={selectedFile}
        selectedFileId={selectedFile?.id ?? null}
        register={register}
        control={control}
        getValues={getValues}
        setError={setError}
        clearErrors={clearErrors}
        setFocus={setFocus}
        onTrackCoverUpload={vi.fn()}
        onTrackCoverProcessingChange={vi.fn()}
        isTrackCoverProcessing={false}
        onDownloadUpdatedFile={vi.fn()}
        selectedFileAlbum={undefined}
        syncFilenames={syncFilenames}
        advancedMetadata
        metadataLinks={{
          artist: true,
          year: true,
          genre: true,
          artwork: true,
          albumArtist: true,
          trackNumber: true,
        }}
        onPreviewMetadataChange={vi.fn()}
        onAudioUpload={vi.fn()}
      />
    </TooltipProvider>
  );
}

describe("track metadata editor form seam", () => {
  it("routes an unavailable track to the empty editor state", () => {
    const markup = renderToStaticMarkup(<EditorHarness selectedFile={null} />);

    expect(markup).toContain("drop your audio here");
    expect(markup).toContain(".mp3,.flac,.m4a,.mp4");
    expect(markup).not.toContain('id="track-title"');
  });

  it("keeps the selected track header and mode control while metadata hydrates", () => {
    const pendingTrack: TagiumFile = {
      id: "pending-track",
      filename: "pending-track.flac",
      status: "pending",
      downloadStatus: "downloading",
    };
    const markup = renderToStaticMarkup(<EditorHarness selectedFile={pendingTrack} />);

    expect(markup).toContain("pending-track.flac");
    expect(markup).toContain("loading metadata");
    expect(markup.match(/aria-label="metadata fields"/g)).toHaveLength(1);
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
      "track-album-artist",
      "track-disc-number",
      "track-bpm",
      "track-composer",
      "track-comment",
    ]) {
      expect(markup).toContain(`for="${id}"`);
      expect(markup).toContain(`id="${id}"`);
    }
  });

  it("renders one mode control and keeps the inactive advanced pane out of focus order", () => {
    const markup = renderToStaticMarkup(<EditorHarness />);

    expect(markup.match(/aria-label="metadata fields"/g)).toHaveLength(1);
    expect(markup).toContain('data-editor-pane="advanced"');
    expect(markup).toMatch(/data-editor-pane="advanced"[^>]*aria-hidden="true"[^>]*inert/);
    expect(markup).toMatch(/data-editor-pane="normal"[^>]*transition-opacity[^>]*opacity-100/);
    expect(markup).toMatch(/data-editor-pane="advanced"[^>]*transition-opacity[^>]*opacity-0/);
    expect(markup.match(/motion-reduce:transition-none/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("slides one switch indicator between normal and advanced modes", () => {
    const normal = renderToStaticMarkup(
      <MetadataEditorModeToggle mode="normal" onChange={vi.fn()} />,
    );
    const advanced = renderToStaticMarkup(
      <MetadataEditorModeToggle mode="advanced" onChange={vi.fn()} />,
    );

    expect(normal).toMatch(/data-metadata-mode-indicator="true"[^>]*translate-x-0/);
    expect(advanced).toMatch(/data-metadata-mode-indicator="true"[^>]*translate-x-full/);
    expect(advanced).toContain("transition-transform");
    expect(advanced).toContain("motion-reduce:transition-none");
  });

  it("provides a persistent accessible reason for a linked album artist", () => {
    const markup = renderToStaticMarkup(<EditorHarness />);

    expect(markup).toMatch(
      /id="track-album-artist"[^>]*aria-describedby="track-album-artist-sync-reason"/,
    );
    expect(markup).toContain('id="track-album-artist-sync-reason"');
    expect(markup).toMatch(/id="track-album-artist-sync-reason" class="sr-only"/);
    expect(markup).toContain(getMetadataLinkDescriptor("albumArtist").disabledReason);
  });

  it("lowercases metadata placeholders", () => {
    const markup = renderToStaticMarkup(<EditorHarness />);

    expect(markup).toContain('placeholder="album artist"');
    expect(markup).toContain('placeholder="composer"');
    expect(markup).toContain('placeholder="add a comment"');
    expect(markup).not.toMatch(/placeholder="[A-Z]/);
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
