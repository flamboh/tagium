import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import ShareAlbumDialog from "@/features/share/ShareAlbumDialog";

vi.mock("@/components/ui/dialog", () => {
  const passthrough = ({ children, ...props }: { children?: unknown; [key: string]: unknown }) =>
    createElement("div", props, children as never);
  return {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogFooter: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
  };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: { children?: unknown; [key: string]: unknown }) =>
    createElement("button", props, children as never),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => createElement("input", props),
}));

const preview = {
  albumTitle: "Night Drive",
  tracks: [
    { key: "a:0", title: "Intro" },
    { key: "a:1", title: "Intro" },
    { key: "b:0", title: "Long final track" },
  ],
  cover: null,
} as const;

const render = (status: "confirm" | "published" | "error" = "confirm") => {
  const state =
    status === "published"
      ? {
          status,
          preview,
          receipt: {
            url: "https://tagium.app/share/slug",
            expiresAt: "2030-01-02T00:00:00Z",
            slug: "slug",
            revocationToken: "token",
          },
        }
      : status === "error"
        ? { status, preview, message: "Could not publish" }
        : { status, preview };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      createElement(ShareAlbumDialog, {
        state,
        onClose: vi.fn(),
        onPublish: vi.fn(),
        onStopSharing: vi.fn(async () => undefined),
      }),
    );
  });
  return renderer;
};

const text = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.type === "string")
    .map((node) => node.children.filter((child): child is string => typeof child === "string"))
    .flat()
    .join(" ");

afterEach(() => vi.unstubAllGlobals());

describe("share album dialog", () => {
  it("renders the compact preview and minimal confirmation copy", () => {
    const renderer = render();
    expect(text(renderer)).toContain("share album: Night Drive");
    expect(text(renderer)).toContain(
      "Anyone with the link can download these tracks with your tags.",
    );
    expect(text(renderer)).not.toContain("permission");
    expect(text(renderer)).not.toContain("3 tracks");
    expect(renderer.root.findAllByProps({ "aria-label": "track preview" })).toHaveLength(1);
    expect(text(renderer)).toContain("Intro");
    expect(renderer.root.findAllByProps({ "aria-label": "no album cover" })).toHaveLength(1);
  });

  it("keeps published copy and revoke actions available", () => {
    const renderer = render("published");
    expect(text(renderer)).toContain("share link ready");
    expect(text(renderer)).toContain("Expires");
    const expectedDate = new Date("2030-01-02T00:00:00Z").toLocaleDateString();
    expect(text(renderer)).toContain(`on ${expectedDate}`);
    const buttonText = renderer.root
      .findAllByType("button")
      .flatMap((button) =>
        button.children.filter((child): child is string => typeof child === "string"),
      );
    expect(buttonText).toEqual(expect.arrayContaining(["copy link", "stop sharing", "done"]));
  });

  it("makes the track list a keyboard-reachable, fixed-height scroll region", () => {
    const renderer = render();
    const list = renderer.root.findByProps({ "aria-label": "track preview" });
    expect(list.type).toBe("ol");
    expect(list.props.tabIndex).toBe(0);
    expect(list.props.className).toContain("overflow-y-auto");
    expect(list.props.className).toContain("h-full");
    const preview = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.className === "string" &&
        node.props.className.includes("grid h-24"),
    );
    expect(preview).toHaveLength(1);
    expect(preview[0].props.className).toContain("sm:h-[136px]");
  });

  it("resets confirmation and stop errors between sessions", () => {
    const onClose = vi.fn();
    const onStopSharing = vi.fn(async () => {
      throw new Error("offline");
    });
    const published = {
      status: "published",
      preview,
      receipt: {
        url: "https://tagium.app/share/slug",
        expiresAt: "2030-01-02T00:00:00Z",
        slug: "slug",
        revocationToken: "token",
      },
    } as const;
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        createElement(ShareAlbumDialog, {
          state: published,
          onClose,
          onPublish: vi.fn(),
          onStopSharing,
        }),
      );
    });
    const stop = () =>
      renderer.root
        .findAllByType("button")
        .find((button) => button.children.includes("stop sharing"))!;
    act(() => {
      stop().props.onClick();
    });
    expect(text(renderer)).toContain("keep sharing");
    act(() => {
      renderer.update(
        createElement(ShareAlbumDialog, {
          state: { status: "closed" },
          onClose,
          onPublish: vi.fn(),
          onStopSharing,
        }),
      );
    });
    act(() => {
      renderer.update(
        createElement(ShareAlbumDialog, {
          state: published,
          onClose,
          onPublish: vi.fn(),
          onStopSharing,
        }),
      );
    });
    expect(text(renderer)).not.toContain("keep sharing");
    expect(text(renderer)).not.toContain("Sharing could not be stopped");
  });

  it("creates and revokes the cover object URL with the retained blob", () => {
    const createObjectURL = vi.fn(() => "blob:preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const coverPreview = {
      ...preview,
      cover: {
        format: "image/png",
        blob: new Blob([new Uint8Array([1, 2])], { type: "image/png" }),
      },
    };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        createElement(ShareAlbumDialog, {
          state: { status: "confirm", preview: coverPreview },
          onClose: vi.fn(),
          onPublish: vi.fn(),
          onStopSharing: vi.fn(async () => undefined),
        }),
      );
    });
    expect(createObjectURL).toHaveBeenCalledWith(coverPreview.cover.blob);
    act(() => {
      renderer.update(
        createElement(ShareAlbumDialog, {
          state: { status: "closed" },
          onClose: vi.fn(),
          onPublish: vi.fn(),
          onStopSharing: vi.fn(async () => undefined),
        }),
      );
    });
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
});
