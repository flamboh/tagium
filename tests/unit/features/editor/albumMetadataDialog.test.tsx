import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import AlbumMetadataDialog, {
  type AlbumMetadataDraft,
} from "@/features/editor/AlbumMetadataDialog";
import { reactChildren, reactText } from "../../../support/reactTestNodes";

const reactHookMocks = vi.hoisted(() => ({
  useEffect: vi.fn(),
  useRef: vi.fn(),
  useState: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: reactHookMocks.useEffect,
    useRef: reactHookMocks.useRef,
    useState: reactHookMocks.useState,
  };
});

type SubmitEvent = { preventDefault: () => void };
type TestElementProps = {
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  label?: string;
  onBlur?: () => void;
  onClick?: () => void;
  onCoverUpload?: (picture: NonNullable<AlbumMetadataDraft["cover"]>) => void;
  onOpenChange?: (open: boolean) => void;
  onProcessingChange?: (processing: boolean) => void;
  onSubmit?: (event: SubmitEvent) => void;
  open?: boolean;
  placeholder?: string;
  required?: boolean;
  type?: string;
  "aria-busy"?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: string;
};
type TestElement = ReactElement<TestElementProps>;

const isElement = (node: ReactNode): node is TestElement => isValidElement<TestElementProps>(node);

const childrenOf = (node: TestElement): ReactNode[] => reactChildren(node);

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

const textContent = reactText;

const createHookHarness = () => {
  const states: unknown[] = [];
  let cursor = 0;
  reactHookMocks.useEffect.mockImplementation(() => undefined);
  reactHookMocks.useRef.mockImplementation(<Value,>(initial: Value) => ({ current: initial }));
  reactHookMocks.useState.mockImplementation(<Value,>(initial: Value | (() => Value)) => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial instanceof Function ? initial() : initial;
    return [
      states[index],
      (next: Value | ((previous: Value) => Value)) => {
        const previous = states[index] as Value;
        states[index] = next instanceof Function ? next(previous) : next;
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
  it("disables invalid submission and shows accessible errors only after blur", () => {
    const hooks = createHookHarness();
    const render = () =>
      hooks.render(() =>
        AlbumMetadataDialog({
          open: true,
          mode: "create",
          draft: { title: "", artist: "", genre: "" },
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

    const submit = findElement(tree, (element) => element.props.type === "submit");
    expect(submit.props.disabled).toBe(true);
    const titleInput = findElement(tree, (element) => element.props.id === "album-title");
    (titleInput.props.onBlur as () => void)();

    tree = render();
    expect(
      textContent(findElement(tree, (element) => element.props.id === "album-title-error")),
    ).toBe("album title is required");
    expect(
      textContent(findElement(tree, (element) => element.props.id === "album-artist-error")),
    ).toBe("");
    expect(
      findElement(tree, (element) => element.props.id === "album-title").props["aria-invalid"],
    ).toBe(true);

    const dialog = findElement(
      tree,
      (element) => element.props.open === true && element.props.onOpenChange !== undefined,
    );
    (dialog.props.onOpenChange as (open: boolean) => void)(false);
    tree = render();
    expect(
      textContent(findElement(tree, (element) => element.props.id === "album-title-error")),
    ).toBe("");
  });

  it("associates every field label with its input", () => {
    const hooks = createHookHarness();
    const tree = hooks.render(() =>
      AlbumMetadataDialog({
        open: true,
        mode: "create",
        draft: { title: "", artist: "", genre: "" },
        onChange: vi.fn(),
        onClose: vi.fn(),
        onSave: vi.fn(),
        placeholder: { title: "Album", artist: "Artist", genre: "Genre", year: "2026" },
      }),
    );

    for (const id of ["album-title", "album-artist", "album-genre", "album-year"]) {
      const field = findElement(tree, (element) => element.props.id === id);
      expect(field.props.label).toEqual(expect.any(String));
    }

    const titleInput = findElement(tree, (element) => element.props.id === "album-title");
    const artistInput = findElement(tree, (element) => element.props.id === "album-artist");
    expect(titleInput.props["aria-describedby"]).toBeUndefined();
    expect(titleInput.props.required).toBe(true);
    expect(titleInput.props["aria-required"]).toBe("true");
    expect(artistInput.props.required).toBe(true);
    expect(artistInput.props["aria-required"]).toBe("true");
    expect(titleInput.props.label).toBe("album title");
  });

  it.each([
    { title: "   ", artist: "Artist" },
    { title: "Album", artist: "   " },
  ])("disables whitespace-only required values", (draft) => {
    const hooks = createHookHarness();
    const tree = hooks.render(() =>
      AlbumMetadataDialog({
        open: true,
        mode: "create",
        draft: { ...draft, genre: "" },
        onChange: vi.fn(),
        onClose: vi.fn(),
        onSave: vi.fn(),
        placeholder: { title: "Album", artist: "Artist", genre: "Genre", year: "2026" },
      }),
    );

    expect(findElement(tree, (element) => element.props.type === "submit").props.disabled).toBe(
      true,
    );
  });

  it("disables submission and exposes a busy state while cover art is processing", () => {
    const hooks = createHookHarness();
    const render = () =>
      hooks.render(() =>
        AlbumMetadataDialog({
          open: true,
          mode: "edit",
          draft: { title: "Album", artist: "Artist", genre: "" },
          onChange: vi.fn(),
          onClose: vi.fn(),
          onSave: vi.fn(),
          placeholder: { title: "Album", artist: "Artist", genre: "Genre", year: "2026" },
        }),
      );

    let tree = render();
    const coverArt = findElement(tree, (element) => element.props.onProcessingChange !== undefined);
    (coverArt.props.onProcessingChange as (processing: boolean) => void)(true);

    tree = render();
    const submit = findElement(tree, (element) => element.props.type === "submit");
    expect(submit.props.disabled).toBe(true);
    expect(submit.props["aria-busy"]).toBe(true);
    expect(textContent(submit)).toBe("processing cover");
  });

  it("adds an uploaded cover to the latest draft", () => {
    const hooks = createHookHarness();
    const onChange = vi.fn();
    const tree = hooks.render(() =>
      AlbumMetadataDialog({
        open: true,
        mode: "create",
        draft: { title: "album", artist: "first artist", genre: "" },
        onChange,
        onClose: vi.fn(),
        onSave: vi.fn(),
        placeholder: { title: "Album", artist: "Artist", genre: "Genre", year: "2026" },
      }),
    );
    const coverArt = findElement(tree, (element) => element.props.onCoverUpload !== undefined);
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
      (element) => textContent(element) === "cancel" && element.props.onClick !== undefined,
    );
    (cancel.props.onClick as () => void)();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
