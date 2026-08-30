import { createElement, type HTMLAttributes } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Schema } from "effect";
import SharedAlbumPage from "@/features/share/SharedAlbumPage";

const toastMocks = vi.hoisted(() => ({
  show: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(toastMocks.show, {
    success: toastMocks.success,
    error: toastMocks.error,
  }),
}));

vi.mock("@/components/ui/dialog", () => {
  const passthrough = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props, children);
  return {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
  };
});

const slug = "k7m4q2";
const state = {
  status: "ready" as const,
  slug,
  expiresAt: "2026-10-20T12:00:00.000Z",
  analyticsId: "a".repeat(43),
  manifest: {
    version: 1 as const,
    kind: "album" as const,
    album: { title: "Shared", artist: "Artist", genre: "Pop" },
    tracks: [
      {
        sourceUrl: "https://soundcloud.com/artist/track",
        audioBitrate: "320" as const,
        metadata: {
          filename: "track",
          title: "Track",
          artist: "Artist",
          album: "Shared",
          genre: "Pop",
        },
      },
    ],
  },
};

const textFromNode = (node: ReactTestRenderer["root"]) =>
  node
    .findAll((child) => Schema.is(Schema.String)(child.type))
    .flatMap((child) => child.children)
    .filter(Schema.is(Schema.String))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

const makeProps = (overrides: Partial<Parameters<typeof SharedAlbumPage>[0]> = {}) => ({
  state,
  workspaceTrackCount: 1,
  anotherTabOpen: false,
  alreadyAddedTargetId: null,
  adding: false,
  canStopSharing: false,
  onBack: vi.fn(),
  onOpenTagium: vi.fn(),
  onAdd: vi.fn(),
  onViewAdded: vi.fn(),
  onStopSharing: vi.fn(async () => undefined),
  ...overrides,
});

const findButton = (renderer: ReactTestRenderer, label: string) =>
  renderer.root.findAllByType("button").find((button) => textFromNode(button) === label);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("shared album page", () => {
  it("waits for an explicit add and supports adding another copy", () => {
    let renderer!: ReactTestRenderer;
    const onAdd = vi.fn();
    const onViewAdded = vi.fn();
    act(() => {
      renderer = create(<SharedAlbumPage {...makeProps({ onAdd, onViewAdded })} />);
    });

    expect(onAdd).not.toHaveBeenCalled();
    void act(() => findButton(renderer, "add to library")?.props.onClick());
    expect(onAdd).toHaveBeenCalledWith();

    act(() => {
      renderer.update(
        <SharedAlbumPage
          {...makeProps({
            alreadyAddedTargetId: "album-1",
            onAdd,
            onViewAdded,
          })}
        />,
      );
    });
    void act(() => findButton(renderer, "open in tagium")?.props.onClick());
    void act(() => findButton(renderer, "add another copy")?.props.onClick());
    expect(onViewAdded).toHaveBeenCalledOnce();
    expect(onAdd).toHaveBeenCalledWith(true);
    act(() => renderer.unmount());
  });

  it("allows an owner to stop sharing and reports a recoverable failure", async () => {
    const onStopSharing = vi.fn(async () => Promise.reject(new Error("offline")));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <SharedAlbumPage {...makeProps({ canStopSharing: true, onStopSharing })} />,
      );
    });

    expect(findButton(renderer, "stop sharing")).toBeDefined();
    await act(async () => findButton(renderer, "stop sharing")?.props.onClick());
    const confirmation = renderer.root
      .findAllByType("button")
      .filter((button) => textFromNode(button) === "stop sharing")
      .at(-1);
    await act(async () => confirmation?.props.onClick());

    expect(onStopSharing).toHaveBeenCalledOnce();
    expect(textFromNode(renderer.root.findByProps({ role: "alert" }))).toContain(
      "sharing could not be stopped",
    );
    act(() => renderer.unmount());
  });
});
