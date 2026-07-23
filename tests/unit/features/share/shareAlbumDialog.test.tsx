import { createElement, useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import ShareAlbumDialog from "@/features/share/ShareAlbumDialog";

const lifecycle = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  dialogOpens: [] as boolean[],
  footerStructures: [] as number[],
}));

vi.mock("@/components/ui/dialog", () => {
  const DialogContent = ({
    children,
    ...props
  }: {
    children?: unknown;
    [key: string]: unknown;
  }) => {
    useEffect(() => {
      lifecycle.mounts += 1;
      return () => {
        lifecycle.unmounts += 1;
      };
    }, []);
    return createElement("div", props, children as never);
  };
  const Dialog = ({
    children,
    open,
    ...props
  }: {
    children?: unknown;
    open?: boolean;
    [key: string]: unknown;
  }) => {
    lifecycle.dialogOpens.push(Boolean(open));
    return createElement("div", props, children as never);
  };
  const passthrough = ({ children, ...props }: { children?: unknown; [key: string]: unknown }) =>
    createElement("div", props, children as never);
  const DialogFooter = ({ children, ...props }: { children?: unknown; [key: string]: unknown }) => {
    const fragment = children as { props?: { children?: unknown } } | undefined;
    const nested = fragment?.props?.children;
    lifecycle.footerStructures.push(Array.isArray(nested) ? nested.length : 1);
    return createElement("div", props, children as never);
  };
  return {
    Dialog,
    DialogContent,
    DialogFooter,
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
  it("keeps one dialog session mounted through publishing and publication", () => {
    lifecycle.mounts = 0;
    lifecycle.unmounts = 0;
    lifecycle.dialogOpens = [];
    lifecycle.footerStructures = [];
    const renderer = render();
    const receipt = {
      url: "https://tagium.app/share/slug",
      expiresAt: "2030-01-02T00:00:00Z",
      slug: "slug",
      revocationToken: "token",
    };

    act(() => {
      renderer.update(
        createElement(ShareAlbumDialog, {
          state: { status: "publishing", preview },
          onClose: vi.fn(),
          onPublish: vi.fn(),
          onStopSharing: vi.fn(async () => undefined),
        }),
      );
    });
    act(() => {
      renderer.update(
        createElement(ShareAlbumDialog, {
          state: { status: "published", preview, receipt },
          onClose: vi.fn(),
          onPublish: vi.fn(),
          onStopSharing: vi.fn(async () => undefined),
        }),
      );
    });

    expect(lifecycle.mounts).toBe(1);
    expect(lifecycle.unmounts).toBe(0);
    expect(lifecycle.dialogOpens).toEqual([true, true, true]);
  });

  it("keeps footer layout structure stable while entering stop confirmation", () => {
    lifecycle.footerStructures = [];
    const renderer = render("published");
    const footer = () =>
      renderer.root.findAll(
        (node) =>
          typeof node.type === "string" &&
          typeof node.props.className === "string" &&
          node.props.className.includes("border-t p-5"),
      )[0];
    const before = footer();
    const stop = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("stop sharing"))!;
    act(() => void stop.props.onClick());
    const after = footer();
    expect(after.props.className).toBe(before.props.className);
    const directChildren = (instance: typeof before) => {
      const child = instance.children[0];
      return child && typeof child === "object" && "props" in child
        ? child.props.children
        : instance.children;
    };
    expect(directChildren(after)).toHaveLength(directChildren(before).length);
    expect(lifecycle.footerStructures.at(-1)).toBe(lifecycle.footerStructures[0]);
  });

  it("reserves stable action slots and uses cover-free stop warning", () => {
    const renderer = render("published");
    const footer = renderer.root.findAllByProps({
      className: "border-t p-5",
    })[0];
    const before = renderer.root.findAllByType("button").map((button) => button.props.className);
    const stop = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("stop sharing"))!;
    act(() => void stop.props.onClick());
    const after = renderer.root.findAllByType("button").map((button) => button.props.className);
    expect(footer.props.className).toBe("border-t p-5");
    expect(before.filter((value) => value.includes("w-full"))).toHaveLength(2);
    expect(after.filter((value) => value.includes("w-full"))).toHaveLength(2);
    expect(text(renderer)).toContain("the link will stop working immediately.");
    expect(text(renderer)).not.toContain("cover");
  });

  it("renders the compact preview and minimal confirmation copy", () => {
    const renderer = render();
    expect(text(renderer)).toContain("share album: Night Drive");
    expect(text(renderer)).toContain(
      "anyone with the link can download these tracks with your tags.",
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
    expect(text(renderer)).toContain("expires");
    const expectedDate = new Date("2030-01-02T00:00:00Z").toLocaleDateString();
    expect(text(renderer)).toContain(`on ${expectedDate}`);
    const buttonText = renderer.root
      .findAllByType("button")
      .flatMap((button) =>
        button.children.filter((child): child is string => typeof child === "string"),
      );
    expect(buttonText).toEqual(expect.arrayContaining(["copy link", "stop sharing", "done"]));
  });

  it("keeps the square cover and track list matched at both responsive sizes", () => {
    const renderer = render();
    const list = renderer.root.findByProps({ "aria-label": "track preview" });
    const cover = renderer.root.findByProps({ "aria-label": "no album cover" });
    expect(list.type).toBe("ol");
    expect(list.props.tabIndex).toBe(0);
    expect(list.props.className).toContain("overflow-y-auto");
    expect(list.props.className).toContain("h-24");
    expect(list.props.className).toContain("sm:h-32");
    expect(cover.props.className).toContain("size-24");
    expect(cover.props.className).toContain("sm:size-32");
    const preview = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.className === "string" &&
        node.props.className.includes("flex gap-4"),
    );
    expect(preview).toHaveLength(1);
    expect(preview[0].props.className).toContain("px-5");
  });

  it("keeps labels from resizing copy and create actions", () => {
    const renderer = render();
    const createButton = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("create share link"));
    expect(createButton?.props.className).toContain("w-44");

    const publishingProps = {
      state: { status: "publishing" as const, preview },
      onClose: vi.fn(),
      onPublish: vi.fn(),
      onStopSharing: vi.fn(async () => undefined),
    };
    act(() => renderer.update(createElement(ShareAlbumDialog, publishingProps)));
    const publishingButton = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("creating link…"));
    expect(publishingButton?.props.className).toBe(createButton?.props.className);

    const publishedRenderer = render("published");
    const copyButton = publishedRenderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("copy link"));
    expect(copyButton?.props.className).toContain("w-32");
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
