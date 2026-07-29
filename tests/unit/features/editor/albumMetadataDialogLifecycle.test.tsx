import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import AlbumMetadataDialog from "@/features/editor/AlbumMetadataDialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/dialog", () => {
  const Container = ({ children, ...props }: { children?: ReactNode }) => (
    <div {...props}>{children}</div>
  );
  return {
    Dialog: Container,
    DialogContent: Container,
    DialogDescription: Container,
    DialogFooter: Container,
    DialogHeader: Container,
    DialogTitle: Container,
  };
});

vi.mock("@/components/ui/tooltip", () => {
  const Container = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    Tooltip: Container,
    TooltipContent: Container,
    TooltipTrigger: Container,
  };
});

vi.mock("@/features/editor/coverArt", () => ({
  default: ({ coverOverlay }: { coverOverlay?: ReactNode }) => (
    <div data-testid="cover-art">{coverOverlay}</div>
  ),
}));

const props = {
  open: true,
  mode: "edit" as const,
  draft: {
    title: "Album",
    artist: "Artist",
    genre: "",
    cover: [{ format: "image/jpeg", type: 3, description: "", data: new Uint8Array([1]) }],
  },
  trackCount: 1,
  onChange: vi.fn(),
  onClose: vi.fn(),
  onSave: vi.fn(),
  placeholder: { title: "Album", artist: "Artist", genre: "Genre", year: "2026" },
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("AlbumMetadataDialog cover sync lifecycle", () => {
  it("invalidates pending sync feedback when the dialog closes", async () => {
    vi.useFakeTimers();
    let resolveSync!: () => void;
    const onSyncCoverToTracks = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve;
        }),
    );
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <AlbumMetadataDialog {...props} onSyncCoverToTracks={onSyncCoverToTracks} />,
      );
    });
    const syncButton = renderer!.root.findByProps({ "aria-label": "sync cover to tracks" });
    act(() => {
      syncButton.props.onClick();
    });
    expect(renderer!.root.findByProps({ "aria-busy": true })).toBeDefined();

    const dialog = renderer!.root.find((node) => typeof node.props.onOpenChange === "function");
    act(() => {
      dialog.props.onOpenChange(false);
    });
    expect(renderer!.root.findAllByProps({ "aria-busy": true })).toHaveLength(0);

    await act(async () => {
      resolveSync();
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(renderer!.root.findAllByProps({ "aria-busy": true })).toHaveLength(0);
    act(() => renderer!.unmount());
  });

  it("clears a scheduled sync timer when a different album remounts the dialog", async () => {
    vi.useFakeTimers();
    const onSyncCoverToTracks = vi.fn(async () => undefined);
    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <AlbumMetadataDialog
          key="album-a"
          {...props}
          instanceKey="album-a"
          onSyncCoverToTracks={onSyncCoverToTracks}
        />,
      );
    });
    await act(async () => {
      renderer!.root.findByProps({ "aria-label": "sync cover to tracks" }).props.onClick();
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      renderer!.update(
        <AlbumMetadataDialog
          key="album-b"
          {...props}
          instanceKey="album-b"
          draft={{ ...props.draft, title: "Other Album" }}
          onSyncCoverToTracks={onSyncCoverToTracks}
        />,
      );
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(renderer!.root.findAllByProps({ "aria-busy": true })).toHaveLength(0);
    act(() => renderer!.unmount());
  });
});
