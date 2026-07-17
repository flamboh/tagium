import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import AlbumMetadataDialog, {
  type AlbumMetadataDraft,
} from "@/features/editor/AlbumMetadataDialog";

const reactHookMocks = vi.hoisted(() => ({ useRef: vi.fn(), useState: vi.fn() }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useRef: reactHookMocks.useRef, useState: reactHookMocks.useState };
});

type TestElement = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

const isElement = (node: ReactNode): node is TestElement =>
  typeof node === "object" && node !== null && "props" in node;

const childrenOf = (node: TestElement): ReactNode[] => {
  const children = node.props.children;
  if (children === undefined || children === null || typeof children === "boolean") return [];
  return Array.isArray(children) ? children : [children];
};

const findElement = (
  node: ReactNode,
  predicate: (element: TestElement) => boolean,
): TestElement => {
  if (isElement(node)) {
    if (predicate(node)) return node;
    for (const child of childrenOf(node)) {
      try {
        return findElement(child, predicate);
      } catch {
        // Continue through the remaining children.
      }
    }
  }
  throw new Error("element not found");
};

const textContent = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isElement(node)) return "";
  return childrenOf(node).map(textContent).join("");
};

const createHookHarness = () => {
  const states: unknown[] = [];
  let cursor = 0;
  reactHookMocks.useRef.mockImplementation((initial: unknown) => ({ current: initial }));
  reactHookMocks.useState.mockImplementation((initial: unknown) => {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
    return [
      states[index],
      (next: unknown) => {
        states[index] = typeof next === "function" ? next(states[index]) : next;
      },
    ];
  });
  return {
    render<T>(module: () => T) {
      cursor = 0;
      return module();
    },
  };
};

afterEach(() => vi.clearAllMocks());

describe("album metadata validation layout", () => {
  it("keeps fixed error rows mounted before and after invalid submission", () => {
    const hooks = createHookHarness();
    const render = () =>
      hooks.render(() =>
        AlbumMetadataDialog({
          open: true,
          mode: "create",
          draft: { title: "", artist: "", genre: "" },
          trackCount: 0,
          onChange: vi.fn(),
          onClose: vi.fn(),
          onSave: vi.fn(),
          placeholder: { title: "Album", artist: "Artist", genre: "Genre", year: "2026" },
        }),
      );

    let tree = render();
    const titleRowBefore = findElement(tree, (element) => element.props.id === "album-title-error");
    const artistRowBefore = findElement(
      tree,
      (element) => element.props.id === "album-artist-error",
    );
    expect(titleRowBefore.props.className).toContain("h-4");
    expect(artistRowBefore.props.className).toContain("h-4");
    expect(textContent(titleRowBefore)).toBe("");

    const form = findElement(tree, (element) => element.type === "form");
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
      preventDefault: vi.fn(),
    });

    tree = render();
    expect(
      textContent(findElement(tree, (element) => element.props.id === "album-title-error")),
    ).toBe("album title is required");
    expect(
      textContent(findElement(tree, (element) => element.props.id === "album-artist-error")),
    ).toBe("artist is required");
  });

  it("associates every field label with its input", () => {
    const hooks = createHookHarness();
    const tree = hooks.render(() =>
      AlbumMetadataDialog({
        open: true,
        mode: "create",
        draft: { title: "", artist: "", genre: "" },
        trackCount: 0,
        onChange: vi.fn(),
        onClose: vi.fn(),
        onSave: vi.fn(),
        placeholder: { title: "Album", artist: "Artist", genre: "Genre", year: "2026" },
      }),
    );

    for (const id of ["album-title", "album-artist", "album-genre", "album-year"]) {
      findElement(tree, (element) => element.type === "label" && element.props.htmlFor === id);
      findElement(tree, (element) => element.props.id === id);
    }

    const titleInput = findElement(tree, (element) => element.props.id === "album-title");
    expect(titleInput.props["aria-describedby"]).toBe("album-title-error");
  });

  it("adds an uploaded cover to the latest draft", () => {
    const hooks = createHookHarness();
    const onChange = vi.fn();
    const tree = hooks.render(() =>
      AlbumMetadataDialog({
        open: true,
        mode: "create",
        draft: { title: "album", artist: "first artist", genre: "" },
        trackCount: 0,
        onChange,
        onClose: vi.fn(),
        onSave: vi.fn(),
        placeholder: { title: "Album", artist: "Artist", genre: "Genre", year: "2026" },
      }),
    );
    const coverArt = findElement(
      tree,
      (element) => typeof element.props.onCoverUpload === "function",
    );
    const cover = [{ format: "image/jpeg", data: new Uint8Array([1]) }];

    (coverArt.props.onCoverUpload as (picture: typeof cover) => void)(cover);

    const updateDraft = onChange.mock.calls[0][0] as (
      draft: AlbumMetadataDraft,
    ) => AlbumMetadataDraft;
    expect(updateDraft({ title: "album", artist: "newer artist", genre: "" })).toEqual({
      title: "album",
      artist: "newer artist",
      genre: "",
      cover,
    });
  });

  it("renders create placeholders and submits a valid create draft", () => {
    const hooks = createHookHarness();
    const onSave = vi.fn();
    const onClose = vi.fn();
    const tree = hooks.render(() =>
      AlbumMetadataDialog({
        open: true,
        mode: "create",
        draft: { title: "New Album", artist: "Artist", genre: "" },
        trackCount: 0,
        onChange: vi.fn(),
        onClose,
        onSave,
        placeholder: {
          title: "Placeholder Album",
          artist: "Placeholder Artist",
          genre: "Placeholder Genre",
          year: "2026",
        },
      }),
    );

    expect(
      findElement(tree, (element) => element.props.id === "album-title").props.placeholder,
    ).toBe("Placeholder Album");
    expect(
      findElement(tree, (element) => element.props.id === "album-artist").props.placeholder,
    ).toBe("Placeholder Artist");
    expect(textContent(tree)).toContain("create album");

    const form = findElement(tree, (element) => element.type === "form");
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
      preventDefault: vi.fn(),
    });
    expect(onSave).toHaveBeenCalledOnce();

    const cancel = findElement(
      tree,
      (element) => textContent(element) === "cancel" && typeof element.props.onClick === "function",
    );
    (cancel.props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("confirms deletion only in edit mode", () => {
    const hooks = createHookHarness();
    const onDelete = vi.fn();
    const render = () =>
      hooks.render(() =>
        AlbumMetadataDialog({
          open: true,
          mode: "edit",
          draft: { title: "Existing Album", artist: "Artist", genre: "Rock" },
          trackCount: 2,
          onChange: vi.fn(),
          onClose: vi.fn(),
          onSave: vi.fn(),
          onDelete,
          placeholder: { title: "Album", artist: "Artist", genre: "Genre", year: "2026" },
        }),
      );

    let tree = render();
    expect(textContent(tree)).toContain("edit album");
    const requestDelete = findElement(
      tree,
      (element) =>
        textContent(element) === "delete album" && typeof element.props.onClick === "function",
    );
    (requestDelete.props.onClick as () => void)();

    tree = render();
    expect(textContent(tree)).toContain("delete album and all 2 tracks?");
    const confirmDelete = findElement(
      tree,
      (element) => textContent(element) === "delete" && typeof element.props.onClick === "function",
    );
    (confirmDelete.props.onClick as () => void)();

    expect(onDelete).toHaveBeenCalledOnce();
  });
});
