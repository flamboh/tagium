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
    expect(textContent(titleRowBefore)).toBe("");

    const submit = findElement(tree, (element) => element.props.type === "submit");
    expect(submit.props.disabled).toBe(true);
    const titleInput = findElement(tree, (element) => element.props.id === "album-title");
    (titleInput.props.onBlur as () => void)();

    tree = render();
    expect(
      textContent(findElement(tree, (element) => element.props.id === "album-title-error")),
    ).not.toBe("");
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

  it("disables whitespace-only required values", () => {
    const hooks = createHookHarness();
    const tree = hooks.render(() =>
      AlbumMetadataDialog({
        open: true,
        mode: "create",
        draft: { title: "   ", artist: "Artist", genre: "" },
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
});
