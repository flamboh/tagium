import {
  createElement,
  Children,
  isValidElement,
  useEffect,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Schema } from "effect";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import ShareAlbumDialog from "@/features/share/ShareAlbumDialog";

const lifecycle = vi.hoisted(() => {
  const dialogOpens: boolean[] = [];
  const contentKeys: string[] = [];
  const footerStructures: number[] = [];
  return {
    mounts: 0,
    unmounts: 0,
    rootMounts: 0,
    rootUnmounts: 0,
    dialogOpens,
    contentKeys,
    footerStructures,
  };
});

vi.mock("@/components/ui/dialog", () => {
  const DialogPanel = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => {
    useEffect(() => {
      lifecycle.mounts += 1;
      return () => {
        lifecycle.unmounts += 1;
      };
    }, []);
    return createElement("div", props, children);
  };
  const DialogContent = ({
    children,
    contentKey,
    ...props
  }: HTMLAttributes<HTMLDivElement> & {
    contentKey?: string;
  }) => {
    lifecycle.contentKeys.push(contentKey ?? "");
    return createElement(DialogPanel, { ...props, key: contentKey }, children);
  };
  const Dialog = ({
    children,
    open,
    ...props
  }: HTMLAttributes<HTMLDivElement> & {
    open?: boolean;
  }) => {
    useEffect(() => {
      lifecycle.rootMounts += 1;
      return () => {
        lifecycle.rootUnmounts += 1;
      };
    }, []);
    lifecycle.dialogOpens.push(Boolean(open));
    return createElement("div", props, children);
  };
  const passthrough = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) =>
    createElement("div", props, children);
  const DialogFooter = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => {
    const nested = isValidElement<{ children?: ReactNode }>(children)
      ? children.props.children
      : children;
    lifecycle.footerStructures.push(Children.count(nested));
    return createElement("div", props, children);
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
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) =>
    createElement("button", props, children),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => createElement("input", props),
}));

const preview = {
  kind: "album",
  title: "Night Drive",
  tracks: [
    { key: "a:0", title: "Intro" },
    { key: "a:1", title: "Intro" },
    { key: "b:0", title: "Long final track" },
  ],
  cover: null,
} as const;

const render = (status: "confirm" | "published" | "link" | "error" = "confirm") => {
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
      : status === "link"
        ? { status, preview, url: "https://tagium.app/share/received" }
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
    .findAll((node) => Schema.is(Schema.String)(node.type))
    .map((node) => node.children.filter(Schema.is(Schema.String)))
    .flat()
    .join(" ");

afterEach(() => vi.unstubAllGlobals());

describe("share album dialog", () => {
  it("mounts a new result panel without closing or remounting the dialog root", () => {
    lifecycle.mounts = 0;
    lifecycle.unmounts = 0;
    lifecycle.rootMounts = 0;
    lifecycle.rootUnmounts = 0;
    lifecycle.dialogOpens = [];
    lifecycle.contentKeys = [];
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

    expect(lifecycle.mounts).toBe(2);
    expect(lifecycle.unmounts).toBe(1);
    expect(lifecycle.rootMounts).toBe(1);
    expect(lifecycle.rootUnmounts).toBe(0);
    expect(lifecycle.dialogOpens).toEqual([true, true, true]);
    expect(lifecycle.contentKeys).toEqual(["share-creator", "share-creator", "share-link"]);
  });

  it("keeps footer layout structure stable while entering stop confirmation", () => {
    lifecycle.footerStructures = [];
    const renderer = render("published");
    const footer = () =>
      renderer.root.findAll(
        (node) =>
          Schema.is(Schema.String)(node.type) &&
          Schema.is(Schema.String)(node.props.className) &&
          node.props.className.includes("border-t p-4"),
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
      return child && !Schema.is(Schema.String)(child) ? child.props.children : instance.children;
    };
    expect(directChildren(after)).toHaveLength(directChildren(before).length);
    expect(lifecycle.footerStructures.at(-1)).toBe(lifecycle.footerStructures[0]);
  });

  it("reserves stable action slots and uses cover-free stop warning", () => {
    const renderer = render("published");
    const footer = renderer.root.findAllByProps({
      className: "border-t p-4",
    })[0];
    const before = renderer.root.findAllByType("button").map((button) => button.props.className);
    const stop = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("stop sharing"))!;
    act(() => void stop.props.onClick());
    const after = renderer.root.findAllByType("button").map((button) => button.props.className);
    expect(footer.props.className).toBe("border-t p-4");
    expect(before.filter((value) => value.includes("w-full"))).toHaveLength(2);
    expect(after.filter((value) => value.includes("w-full"))).toHaveLength(2);
    expect(text(renderer)).toContain("the link will stop working immediately.");
    expect(text(renderer)).toContain("anyone who already added the album keeps their copy.");
    expect(text(renderer)).not.toContain("cover");
  });

  it("renders the compact preview and explains what recipients add", () => {
    const renderer = render();
    expect(text(renderer)).toContain("share album: Night Drive");
    expect(text(renderer)).toContain(
      "anyone with the link can add this album. tracks are added from their original sources with these shared tags.",
    );
    expect(text(renderer)).not.toMatch(/\b(?:Anyone|Expires)\b/);
    expect(text(renderer)).not.toContain("permission");
    expect(text(renderer)).not.toContain("3 tracks");
    expect(renderer.root.findAllByProps({ "aria-label": "track preview" })).toHaveLength(1);
    expect(text(renderer)).toContain("Intro");
    expect(renderer.root.findAllByProps({ "aria-label": "no album cover" })).toHaveLength(1);
  });

  it("uses track-specific creator copy for a track publication", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        createElement(ShareAlbumDialog, {
          state: {
            status: "confirm",
            preview: { ...preview, kind: "track", title: "Intro", tracks: [preview.tracks[0]] },
          },
          onClose: vi.fn(),
          onPublish: vi.fn(),
          onStopSharing: vi.fn(async () => undefined),
        }),
      );
    });

    expect(text(renderer)).toContain("share track: Intro");
    expect(text(renderer)).toContain(
      "anyone with the link can add this track. it is downloaded from its original source with these shared tags.",
    );
    expect(renderer.root.findAllByProps({ "aria-label": "no track artwork" })).toHaveLength(1);
  });

  it("uses concise update copy without changing the dialog structure", () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        createElement(ShareAlbumDialog, {
          state: { status: "confirm", intent: "update", preview },
          onClose: vi.fn(),
          onPublish: vi.fn(),
          onStopSharing: vi.fn(async () => undefined),
        }),
      );
    });
    expect(text(renderer)).toContain("share album: Night Drive");
    expect(text(renderer)).toContain("anyone with the link can add this album.");
    expect(text(renderer)).toContain("from their original sources with these shared tags.");
    expect(text(renderer)).toContain("the link keeps its current expiration.");
    expect(text(renderer)).not.toContain("expires in 90 days.");
    const updateButton = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("update shared album"));
    expect(updateButton?.props.className).toContain("w-full");

    act(() => {
      renderer.update(
        createElement(ShareAlbumDialog, {
          state: { status: "publishing", intent: "update", preview },
          onClose: vi.fn(),
          onPublish: vi.fn(),
          onStopSharing: vi.fn(async () => undefined),
        }),
      );
    });
    expect(text(renderer)).toContain("updating shared album…");
  });

  it("keeps published copy and revoke actions available", () => {
    const renderer = render("published");
    expect(text(renderer)).toContain("share album: Night Drive");
    expect(text(renderer)).toContain("share link");
    const expectedDate = new Date("2030-01-02T00:00:00Z").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(text(renderer)).toContain(
      `expires ${expectedDate} · stop sharing to turn the link off at any time`,
    );
    const buttonText = renderer.root
      .findAllByType("button")
      .flatMap((button) => button.children.filter(Schema.is(Schema.String)));
    expect(buttonText).toEqual(expect.arrayContaining(["copy link", "stop sharing", "done"]));
  });

  it("selects the link and announces manual copy when clipboard access fails", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const renderer = render("published");
    const copy = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("copy link"))!;

    await act(async () => void (await copy.props.onClick()));

    expect(writeText).toHaveBeenCalledWith("https://tagium.app/share/slug");
    expect(text(renderer)).toContain("select and copy the link");
  });

  it("reopens a received album link without owner-only controls", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const renderer = render("link");

    expect(text(renderer)).toContain("share link");
    expect(text(renderer)).not.toContain("expires");
    expect(text(renderer)).not.toContain("stop sharing");
    expect(
      renderer.root
        .findAllByType("button")
        .flatMap((button) => button.children.filter(Schema.is(Schema.String))),
    ).toEqual(expect.arrayContaining(["copy link", "done"]));

    const copy = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("copy link"))!;
    await act(async () => void (await copy.props.onClick()));
    expect(writeText).toHaveBeenCalledWith("https://tagium.app/share/received");
  });

  it("removes the close control while a publication action is running", () => {
    const renderer = render();
    const dialogContent = () =>
      renderer.root.findAll(
        (node) =>
          Schema.is(Schema.String)(node.type) &&
          Schema.is(Schema.String)(node.props.className) &&
          node.props.className.includes("max-h-[calc(100dvh-2rem)]"),
      )[0];
    expect(dialogContent().props.showCloseButton).toBe(true);

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
    expect(dialogContent().props.showCloseButton).toBe(false);
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
        Schema.is(Schema.String)(node.type) &&
        Schema.is(Schema.String)(node.props.className) &&
        node.props.className.includes("gap-4") &&
        node.props.className.includes("px-5"),
    );
    expect(preview).toHaveLength(1);
    expect(preview[0].props.className).toContain("px-5");
  });

  it("contains unbroken track titles and truncates them with an accessible full label", () => {
    const unbrokenTitle = "TRACK".repeat(100);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        createElement(ShareAlbumDialog, {
          state: {
            status: "confirm",
            preview: {
              ...preview,
              tracks: [{ key: "long:0", title: unbrokenTitle }],
            },
          },
          onClose: vi.fn(),
          onPublish: vi.fn(),
          onStopSharing: vi.fn(async () => undefined),
        }),
      );
    });

    const previewRow = renderer.root.findAll(
      (node) =>
        Schema.is(Schema.String)(node.type) &&
        Schema.is(Schema.String)(node.props.className) &&
        node.props.className.includes("gap-4") &&
        node.props.className.includes("px-5"),
    )[0];
    const list = renderer.root.findByProps({ "aria-label": "track preview" });
    const title = renderer.root.findByProps({ title: unbrokenTitle });
    const titleText = title.find(
      (node) =>
        node.type === "span" &&
        Schema.is(Schema.String)(node.props.className) &&
        node.props.className.includes("truncate"),
    );

    expect(previewRow.props.className).toContain("min-w-0");
    expect(list.props.className).toContain("overflow-x-hidden");
    expect(title.props.title).toBe(unbrokenTitle);
    expect(titleText.props.className).toContain("min-w-0");
    expect(titleText.props.className).toContain("truncate");
    expect(titleText.children).toContain(unbrokenTitle);
  });

  it("keeps labels from resizing copy and create actions", () => {
    const renderer = render();
    const createButton = renderer.root
      .findAllByType("button")
      .find((button) => button.children.includes("create share link"));
    expect(createButton?.props.className).toContain("w-full");

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
