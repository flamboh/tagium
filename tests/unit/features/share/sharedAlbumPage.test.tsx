import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import SharedAlbumPage from "@/features/share/SharedAlbumPage";

const slug = "AbcdEFGHijklmno_123-45";
const props = {
  state: {
    status: "ready" as const,
    slug,
    expiresAt: "2026-10-20T12:00:00.000Z",
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
  },
  workspaceTrackCount: 1,
  anotherTabOpen: true,
  alreadyAddedAlbumId: null,
  adding: false,
  canStopSharing: false,
  onBack: vi.fn(),
  onOpenTagium: vi.fn(),
  onAdd: vi.fn(),
  onViewAlbum: vi.fn(),
  onStopSharing: vi.fn(async () => undefined),
};

const copyButton = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType("button").find((button) => button.children.includes("copy link"));

afterEach(() => vi.unstubAllGlobals());

describe("shared album preview", () => {
  it("copies the canonical link for another tab and confirms success", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SharedAlbumPage, props));
    });

    await act(async () => {
      await copyButton(renderer)?.props.onClick();
    });

    expect(writeText).toHaveBeenCalledWith(`https://tagium.app/share/${slug}`);
    const status = renderer.root
      .findByProps({ role: "status" })
      .children.find((child): child is string => typeof child === "string");
    expect(status).toContain("Share link copied.");
  });

  it("shows a recoverable manual-copy path when clipboard access fails", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SharedAlbumPage, props));
    });

    await act(async () => {
      await copyButton(renderer)?.props.onClick();
    });

    expect(renderer.root.findByProps({ "aria-label": "share link" }).props.className).not.toContain(
      "sr-only",
    );
    const status = renderer.root
      .findByProps({ role: "status" })
      .children.find((child): child is string => typeof child === "string");
    expect(status).toContain("Copy failed.");
  });

  it("does not add a direct-route preview until the explicit download action", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SharedAlbumPage, props));
    });
    expect(props.onAdd).not.toHaveBeenCalled();

    const download = renderer.root
      .findAllByType("button")
      .find((button) =>
        button.children.some((child) => typeof child === "string" && child.includes("download")),
      );
    act(() => {
      download?.props.onClick();
    });
    expect(props.onAdd).toHaveBeenCalledOnce();
  });
});
