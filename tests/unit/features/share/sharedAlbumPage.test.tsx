import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import SharedAlbumPage from "@/features/share/SharedAlbumPage";

vi.mock("@/components/ui/dialog", () => {
  const passthrough = ({ children, ...props }: { children?: unknown; [key: string]: unknown }) =>
    createElement("div", props, children as never);
  return {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
  };
});
vi.mock("@/components/ui/popover", () => {
  const passthrough = ({ children, ...props }: { children?: unknown; [key: string]: unknown }) =>
    createElement("div", props, children as never);
  return {
    Popover: passthrough,
    PopoverContent: passthrough,
    PopoverTrigger: passthrough,
  };
});

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
  renderer.root
    .findAllByType("button")
    .find((button) => button.children.some((child) => child === "Copy link"));

const buttonText = (button: ReactTestRenderer["root"]) =>
  button
    .findAll((node) => typeof node.type === "string")
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === "string")
    .join("")
    .replace(/\s+/g, " ")
    .trim();

afterEach(() => vi.unstubAllGlobals());

describe("shared album preview", () => {
  it("links the album title to its exact source with a safe external target", async () => {
    const sourceUrl = "https://www.youtube.com/playlist?list=PL_exact";
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(SharedAlbumPage, {
          ...props,
          state: {
            ...props.state,
            manifest: {
              ...props.state.manifest,
              album: { ...props.state.manifest.album, sourceUrl },
            },
          },
        }),
      );
    });
    const titleLink = renderer.root.findByType("a");
    expect(titleLink.props.href).toBe(sourceUrl);
    expect(titleLink.props.target).toBe("_blank");
    expect(titleLink.props.rel).toBe("noopener noreferrer");
  });

  it("renders a plain album title without falling back to a track source", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SharedAlbumPage, props));
    });
    expect(renderer.root.findAllByType("a")).toHaveLength(0);
    expect(renderer.root.findByType("h1").children).toContain("Shared");
  });

  it("keeps unavailable state to one Back to Tagium action", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(SharedAlbumPage, {
          ...props,
          state: { status: "unavailable", slug, reason: "unavailable" },
        }),
      );
    });
    expect(renderer.root.findAllByType("button")).toHaveLength(1);
  });

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
        button.children.some(
          (child) => typeof child === "string" && child.toLowerCase().includes("download"),
        ),
      );
    act(() => {
      download?.props.onClick();
    });
    expect(props.onAdd).toHaveBeenCalledOnce();
  });

  it("offers Open album and an explicit duplicate download when already added", async () => {
    const onAdd = vi.fn();
    const onViewAlbum = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(SharedAlbumPage, {
          ...props,
          alreadyAddedAlbumId: "album-1",
          onAdd,
          onViewAlbum,
        }),
      );
    });
    const buttons = renderer.root.findAllByType("button");
    const open = buttons.find((button) => button.children.includes("Open album"));
    const duplicate = buttons.find((button) => button.children.includes("Download another copy"));
    void act(() => open?.props.onClick());
    void act(() => duplicate?.props.onClick());
    expect(onViewAlbum).toHaveBeenCalledOnce();
    expect(onAdd).toHaveBeenCalledWith(true);
  });

  it("shows a recoverable error when the owner cannot stop sharing", async () => {
    const onStopSharing = vi.fn(async () => {
      throw new Error("offline");
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(SharedAlbumPage, {
          ...props,
          canStopSharing: true,
          onStopSharing,
        }),
      );
    });

    const menuAction = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("stop sharing"));
    void act(() => menuAction?.props.onClick());

    const confirmation = renderer.root
      .findAllByType("button")
      .filter((button) => buttonText(button) === "stop sharing")
      .at(-1);
    await act(async () => {
      confirmation?.props.onClick();
      await Promise.resolve();
    });

    expect(onStopSharing).toHaveBeenCalledOnce();
    expect(
      renderer.root
        .findByProps({ role: "alert" })
        .children.filter((child): child is string => typeof child === "string")
        .join(" "),
    ).toContain("Sharing could not be stopped");
  });

  it("closes the owner confirmation after sharing is stopped", async () => {
    const onStopSharing = vi.fn(async () => undefined);
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(SharedAlbumPage, {
          ...props,
          canStopSharing: true,
          onStopSharing,
        }),
      );
    });

    const menuAction = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("stop sharing"));
    void act(() => menuAction?.props.onClick());
    expect(
      renderer.root.findAllByType("div").filter((node) => node.props.open === true),
    ).toHaveLength(1);

    const confirmation = renderer.root
      .findAllByType("button")
      .filter((button) => buttonText(button) === "stop sharing")
      .at(-1);
    await act(async () => {
      confirmation?.props.onClick();
      await Promise.resolve();
    });

    expect(onStopSharing).toHaveBeenCalledOnce();
    expect(
      renderer.root.findAllByType("div").filter((node) => node.props.open === true),
    ).toHaveLength(0);
  });

  it("keeps duplicate manifest tracks as separate rows", async () => {
    const duplicateProps = {
      ...props,
      state: {
        ...props.state,
        manifest: {
          ...props.state.manifest,
          tracks: [props.state.manifest.tracks[0]!, props.state.manifest.tracks[0]!],
        },
      },
    };
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SharedAlbumPage, duplicateProps));
    });

    expect(renderer.root.findAllByType("li")).toHaveLength(2);
    expect(
      renderer.root.findAllByType("li").filter((node) => node.children.includes("Track")),
    ).toHaveLength(2);
  });
});
