import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useEffect, type ReactElement, type ReactNode } from "react";
import { useForm, type UseFormReturn, type UseFormSetFocus } from "react-hook-form";
import { describe, expect, it, vi } from "vite-plus/test";
import { TooltipProvider } from "@/components/ui/tooltip";
import TrackMetadataEditor, {
  AdvancedTrackDetailsFields,
  MetadataEditorModeToggle,
} from "@/features/editor/TrackMetadataEditor";
import { getAdvancedMetadataValidationErrors } from "@/features/editor/audioTaggerUtils";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";
import { getMetadataLinkState } from "@/features/library/metadataLinks";
import type { AudioMetadata, TagiumFile } from "@/features/library/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/features/editor/coverArt", () => ({
  default: () => <div data-testid="cover-art" />,
}));

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
  discNumber: null,
  composer: "",
  bpm: null,
  comment: "",
};

const loadedTrack: TagiumFile = {
  id: "track-1",
  format: "mp3",
  filename: "track-1.mp3",
  status: "saved",
  downloadStatus: "ready",
  metadata,
};

const validMetadata: AudioMetadata = {
  ...metadata,
  filename: "track",
  title: "Track",
  artist: "Artist",
  albumArtist: "Artist",
};

const readyTrack: TagiumFile = {
  ...loadedTrack,
  file: new File(["audio"], "track.mp3"),
  originalFile: new File(["audio"], "track.mp3"),
  metadata: validMetadata,
};

function EditorHarness({
  selectedFile = loadedTrack,
  syncFilenames = true,
  advancedMetadata = false,
  albumArtistLinked = true,
  inAlbum = false,
}: {
  selectedFile?: TagiumFile | null;
  syncFilenames?: boolean;
  advancedMetadata?: boolean;
  albumArtistLinked?: boolean;
  inAlbum?: boolean;
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
        selectedFileAlbum={
          inAlbum
            ? {
                id: "album-1",
                title: "Album",
                artist: "Artist",
                genre: "",
                trackIds: [selectedFile!.id],
              }
            : undefined
        }
        syncFilenames={syncFilenames}
        advancedMetadata={advancedMetadata}
        metadataLinks={getMetadataLinkState({
          ...DEFAULT_APP_SETTINGS,
          metadataLinks: {
            ...DEFAULT_APP_SETTINGS.metadataLinks,
            albumArtist: albumArtistLinked,
          },
        })}
        onPreviewMetadataChange={vi.fn()}
      />
    </TooltipProvider>
  );
}

function AdvancedFieldsHarness({ albumArtistLinked = true }: { albumArtistLinked?: boolean }) {
  const { register } = useForm<AudioMetadata>({ defaultValues: metadata });
  const advancedFields = {
    registrations: {
      albumArtist: register("albumArtist"),
      discNumber: register("discNumber"),
      composer: register("composer"),
      bpm: register("bpm"),
      comment: register("comment"),
    },
    errors: {},
  };
  return (
    <TooltipProvider>
      <AdvancedTrackDetailsFields
        registrations={advancedFields.registrations}
        errors={advancedFields.errors}
        albumArtistLinked={albumArtistLinked}
        linkedArtistValue="Artist"
      />
    </TooltipProvider>
  );
}

function MountedEditorHarness({
  onDownload,
  exposeForm,
  setFocus,
}: {
  onDownload: (data: AudioMetadata) => void;
  exposeForm?: (form: UseFormReturn<AudioMetadata>) => void;
  setFocus?: UseFormSetFocus<AudioMetadata>;
}) {
  const form = useForm<AudioMetadata>({ defaultValues: validMetadata });
  useEffect(() => {
    exposeForm?.(form);
  }, [exposeForm, form]);
  return (
    <TrackMetadataEditor
      selectedFile={readyTrack}
      selectedFileId={readyTrack.id}
      register={form.register}
      control={form.control}
      getValues={form.getValues}
      setError={form.setError}
      clearErrors={form.clearErrors}
      setFocus={setFocus ?? form.setFocus}
      onTrackCoverUpload={vi.fn()}
      onTrackCoverProcessingChange={vi.fn()}
      isTrackCoverProcessing={false}
      onDownloadUpdatedFile={onDownload}
      selectedFileAlbum={undefined}
      syncFilenames
      advancedMetadata
      metadataLinks={getMetadataLinkState(DEFAULT_APP_SETTINGS)}
      onPreviewMetadataChange={vi.fn()}
    />
  );
}

const findButton = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAllByType("button").find((button) => button.children.includes(label))!;

const createFormNodeMocks = () => {
  const nodes = new Map<
    string,
    {
      focus: ReturnType<typeof vi.fn>;
      select: ReturnType<typeof vi.fn>;
      name: unknown;
      type: unknown;
      value: unknown;
    }
  >();
  return {
    nodes,
    createNodeMock: (element: ReactElement) => {
      if (typeof element.type !== "string") return {};
      const props = element.props as Record<string, unknown>;
      const node = {
        focus: vi.fn(),
        select: vi.fn(),
        name: props.name,
        type: props.type,
        value: props.value ?? "",
      };
      if (typeof props.id === "string") nodes.set(props.id, node);
      return node;
    },
  };
};

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

  it("keeps the advanced editor behind the settings gate", () => {
    const normalMarkup = renderToStaticMarkup(<EditorHarness />);
    const enabledMarkup = renderToStaticMarkup(<EditorHarness advancedMetadata />);

    expect(normalMarkup).not.toContain("advanced</button>");
    expect(normalMarkup).not.toContain('id="track-album-artist"');
    expect(enabledMarkup).toContain("advanced</button>");
  });

  it("renders all five advanced fields in the swapped form area", () => {
    const output = renderToStaticMarkup(<AdvancedFieldsHarness />);
    for (const id of [
      "track-album-artist",
      "track-disc-number",
      "track-composer",
      "track-bpm",
      "track-comment",
    ]) {
      expect(output).toContain(id);
    }
  });

  it("explains and disables album artist while it is linked", () => {
    const linkedMarkup = renderToStaticMarkup(<AdvancedFieldsHarness />);
    const unlinkedMarkup = renderToStaticMarkup(
      <AdvancedFieldsHarness albumArtistLinked={false} />,
    );

    expect(linkedMarkup).toMatch(/id="track-album-artist"[^>]*disabled/);
    expect(linkedMarkup).toContain("follows track artist while linked");
    expect(unlinkedMarkup).not.toMatch(/id="track-album-artist"[^>]*disabled/);
  });

  it("mounts keyboard-native mode buttons and switches mode", () => {
    const onChange = vi.fn();
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<MetadataEditorModeToggle mode="normal" onChange={onChange} />);
    });

    const buttons = renderer!.root.findAllByType("button");
    expect(buttons).toHaveLength(2);
    expect(buttons.map((button) => button.props.type)).toEqual(["button", "button"]);
    expect(buttons.map((button) => button.props["aria-pressed"])).toEqual([true, false]);
    act(() => void buttons[1].props.onClick());
    expect(onChange).toHaveBeenCalledWith("advanced");
    act(() => renderer!.unmount());
  });

  it("keeps mode and advanced field layouts constrained on narrow screens", () => {
    const toggleMarkup = renderToStaticMarkup(
      <MetadataEditorModeToggle mode="normal" onChange={vi.fn()} />,
    );
    const advancedMarkup = renderToStaticMarkup(<AdvancedFieldsHarness />);

    expect(toggleMarkup).toContain("min-w-0 grid-cols-2");
    expect(toggleMarkup).toContain('aria-label="metadata fields"');
    expect(advancedMarkup).toContain("grid grid-cols-2 gap-2");
    expect(advancedMarkup).toContain("w-full resize-y");
  });

  it.each([
    { field: "discNumber" as const, value: "1.5", correction: 2 },
    { field: "discNumber" as const, value: "0", correction: 1 },
    { field: "bpm" as const, value: "0", correction: 128 },
  ])(
    "blocks hidden $field=$value, reveals its error, and submits after correction",
    async ({ field, value, correction }) => {
      const onDownload = vi.fn();
      const setFocus = vi.fn();
      const formNodes = createFormNodeMocks();
      let form: UseFormReturn<AudioMetadata>;
      let renderer: ReactTestRenderer;
      act(() => {
        renderer = create(
          <MountedEditorHarness
            onDownload={onDownload}
            exposeForm={(current) => {
              form = current;
            }}
            setFocus={setFocus}
          />,
          { createNodeMock: formNodes.createNodeMock },
        );
      });
      act(() => void findButton(renderer!, "advanced").props.onClick());
      act(() => {
        form!.setValue("discNumber", 1);
        form!.setValue("bpm", 128);
      });
      const inputId = field === "discNumber" ? "track-disc-number" : "track-bpm";
      const invalidNode = formNodes.nodes.get(inputId)!;
      invalidNode.value = value;
      await act(async () => {
        await renderer!.root.findByProps({ id: inputId }).props.onChange({
          target: invalidNode,
          type: "change",
        });
      });
      act(() => void findButton(renderer!, "normal").props.onClick());
      await act(async () => void findButton(renderer!, "download track").props.onClick());

      expect(onDownload).not.toHaveBeenCalled();
      expect(findButton(renderer!, "advanced").props["aria-pressed"]).toBe(true);
      expect(JSON.stringify(renderer!.toJSON())).toContain(
        field === "discNumber"
          ? "disc number must be a whole number from 1 to 999"
          : "BPM must be from 1 to 999",
      );
      expect(setFocus).toHaveBeenCalledWith(field, { shouldSelect: true });

      const correctedNode = formNodes.nodes.get(inputId)!;
      correctedNode.value = String(correction);
      await act(async () => {
        await renderer!.root.findByProps({ id: inputId }).props.onChange({
          target: correctedNode,
          type: "change",
        });
      });
      act(() => {
        form!.setValue("discNumber", field === "discNumber" ? correction : 1, {
          shouldDirty: true,
        });
        form!.setValue("bpm", field === "bpm" ? correction : 128, { shouldDirty: true });
      });
      expect(getAdvancedMetadataValidationErrors(form!.getValues())).toEqual({});
      await act(async () => void findButton(renderer!, "download track").props.onClick());
      expect(onDownload).toHaveBeenCalledOnce();
      act(() => renderer!.unmount());
    },
  );

  it("shows the current artist as linked album artist after an edit", async () => {
    const formNodes = createFormNodeMocks();
    let renderer: ReactTestRenderer;
    act(() => {
      renderer = create(<MountedEditorHarness onDownload={vi.fn()} />, {
        createNodeMock: formNodes.createNodeMock,
      });
    });
    const artistNode = formNodes.nodes.get("track-artist")!;
    artistNode.value = "Edited Artist";
    await act(async () => {
      await renderer!.root.findByProps({ id: "track-artist" }).props.onChange({
        target: artistNode,
        type: "change",
      });
    });
    act(() => void findButton(renderer!, "advanced").props.onClick());

    expect(renderer!.root.findByProps({ id: "track-album-artist" }).props.value).toBe(
      "Edited Artist",
    );
    act(() => renderer!.unmount());
  });
});
