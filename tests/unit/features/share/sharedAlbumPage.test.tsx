import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
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
  anotherTabOpen: false,
  alreadyAddedAlbumId: null,
  adding: false,
  canStopSharing: false,
  onBack: vi.fn(),
  onOpenTagium: vi.fn(),
  onAdd: vi.fn(),
  onViewAlbum: vi.fn(),
  onStopSharing: vi.fn(async () => undefined),
};

const buttonText = (button: ReactTestRenderer["root"]) =>
  button
    .findAll((node) => typeof node.type === "string")
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === "string")
    .join("")
    .replace(/\s+/g, " ")
    .trim();

const findButton = (renderer: ReactTestRenderer, text: string) =>
  renderer.root.findAllByType("button").find((button) => buttonText(button) === text);

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("shared album preview", () => {
  it("uses a wordmark link and demotes the album source below a plain title", async () => {
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

    const wordmark = renderer.root
      .findAllByType("a")
      .find((link) => link.children.includes("tagium"));
    const source = renderer.root.findAllByType("a").find((link) => link.props.href === sourceUrl);
    expect(wordmark?.props.href).toBe("/");
    expect(source?.props.target).toBe("_blank");
    expect(source?.props.rel).toBe("noopener noreferrer");
    expect(buttonText(renderer.root.findByType("h1"))).toBe("Shared");
    expect(renderer.root.findByType("h1").findAllByType("a")).toHaveLength(0);
  });

  it("shows recipient context and explains the add behavior without existing-track copy", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SharedAlbumPage, props));
    });
    const text = buttonText(renderer.root);
    expect(text).toContain("shared album · 1 track · link expires oct 20");
    expect(text).toContain(
      "adding downloads each track from its original source with the shared tags.",
    );
    expect(text).not.toContain("your current tracks will stay here");
  });

  it("keeps loading, ready, and unavailable states in the same header and max-width shell", async () => {
    const states = [
      { status: "loading" as const, slug },
      props.state,
      { status: "unavailable" as const, slug, reason: "unavailable" as const },
    ];

    for (const state of states) {
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(createElement(SharedAlbumPage, { ...props, state }));
      });
      expect(renderer.root.findByType("header").props.className).toContain("h-14");
      expect(renderer.root.findByType("main").props.className).toContain("max-w-3xl");
    }
  });

  it("uses clear unavailable and newer-version recovery copy", async () => {
    for (const [reason, expected] of [
      ["unavailable", "the link may have expired, or sharing was stopped."],
      [
        "newer-version",
        "reload the page to update, then open the link again. the album has not been added.",
      ],
    ] as const) {
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          createElement(SharedAlbumPage, {
            ...props,
            state: { status: "unavailable", slug, reason },
          }),
        );
      });
      expect(buttonText(renderer.root)).toContain(expected);
    }
  });

  it("delays the another-tab toast and copies its canonical link action", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SharedAlbumPage, { ...props, anotherTabOpen: true }));
    });

    act(() => {
      vi.advanceTimersByTime(1_499);
    });
    expect(toastMocks.show).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(toastMocks.show).toHaveBeenCalledWith(
      "tagium is already open in another tab. copy the link and add the album there instead.",
      expect.objectContaining({ action: expect.objectContaining({ label: "copy link" }) }),
    );

    const options = toastMocks.show.mock.calls[0]?.[1] as {
      action: { onClick: () => Promise<void> | void };
    };
    await act(async () => options.action.onClick());
    expect(writeText).toHaveBeenCalledWith(`https://tagium.app/share/${slug}`);
    expect(toastMocks.success).toHaveBeenCalledWith("share link copied");
    renderer.unmount();
  });

  it("keeps a visible manual-copy recovery in the toast when clipboard access fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SharedAlbumPage, { ...props, anotherTabOpen: true }));
    });
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    const options = toastMocks.show.mock.calls[0]?.[1] as {
      action: { onClick: () => Promise<void> | void };
    };
    await act(async () => options.action.onClick());
    expect(toastMocks.error).toHaveBeenCalledWith("copy failed", {
      description: `copy this link and paste it in the other tab: https://tagium.app/share/${slug}`,
    });
    renderer.unmount();
  });

  it("adds to the library only after the explicit action", async () => {
    const onAdd = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(SharedAlbumPage, { ...props, onAdd }));
    });
    expect(onAdd).not.toHaveBeenCalled();
    void act(() => findButton(renderer, "add to library")?.props.onClick());
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("opens an added album and offers a secondary add-another-copy action", async () => {
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
    void act(() => findButton(renderer, "open in tagium")?.props.onClick());
    void act(() => findButton(renderer, "add another copy")?.props.onClick());
    expect(onViewAlbum).toHaveBeenCalledOnce();
    expect(onAdd).toHaveBeenCalledWith(true);
  });

  it("keeps every primary action state the same size", async () => {
    const states = [
      { alreadyAddedAlbumId: null, adding: false, label: "add to library" },
      { alreadyAddedAlbumId: null, adding: true, label: "adding album…" },
      { alreadyAddedAlbumId: "album-1", adding: false, label: "open in tagium" },
    ] as const;

    for (const state of states) {
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(createElement(SharedAlbumPage, { ...props, ...state }));
      });
      const primary = findButton(renderer, state.label);
      expect(primary?.props.className).toContain("h-10");
      expect(primary?.props.className).toContain("w-40");
      expect(primary?.props.className).toContain("max-sm:w-full");
    }
  });

  it("shows the owner stop-sharing action directly and keeps failure recoverable", async () => {
    const onStopSharing = vi.fn(async () => Promise.reject(new Error("offline")));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(SharedAlbumPage, { ...props, canStopSharing: true, onStopSharing }),
      );
    });

    const header = renderer.root.findByType("header");
    expect(findButton(renderer, "stop sharing")).toBeDefined();
    expect(header.findAllByProps({ "aria-label": "shared album menu" })).toHaveLength(0);
    void act(() => findButton(renderer, "stop sharing")?.props.onClick());
    const confirmation = renderer.root
      .findAllByType("button")
      .filter((button) => buttonText(button) === "stop sharing")
      .at(-1);
    await act(async () => {
      confirmation?.props.onClick();
      await Promise.resolve();
    });
    expect(onStopSharing).toHaveBeenCalledOnce();
    expect(buttonText(renderer.root.findByProps({ role: "alert" }))).toContain(
      "sharing could not be stopped",
    );
  });

  it("explains that stopping a link does not remove albums already added", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(SharedAlbumPage, {
          ...props,
          canStopSharing: true,
        }),
      );
    });
    void act(() => findButton(renderer, "stop sharing")?.props.onClick());
    expect(buttonText(renderer.root)).toContain(
      "the link will stop working immediately. anyone who already added the album keeps their copy.",
    );
  });

  it("renders numbered bordered rows and only shows a differing track artist", async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        createElement(SharedAlbumPage, {
          ...props,
          state: {
            ...props.state,
            manifest: {
              ...props.state.manifest,
              tracks: [
                props.state.manifest.tracks[0]!,
                {
                  ...props.state.manifest.tracks[0]!,
                  metadata: {
                    ...props.state.manifest.tracks[0]!.metadata,
                    title: "Guest Track",
                    artist: "Guest",
                  },
                },
              ],
            },
          },
        }),
      );
    });

    const rows = renderer.root.findAllByType("li");
    expect(rows).toHaveLength(2);
    expect(buttonText(renderer.root)).toContain("2 tracks");
    expect(buttonText(rows[0]!)).toBe("1Track");
    expect(buttonText(rows[1]!)).toBe("2Guest TrackGuest");
    expect(rows[0]?.parent?.props.className).toContain("border");
  });
});
