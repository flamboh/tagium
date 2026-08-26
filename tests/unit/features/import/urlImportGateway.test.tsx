import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useMediaUrlEntryController } from "@/features/import/useMediaUrlEntryController";
import MediaUrlEntry, { type MediaUrlEntryLayout } from "@/shared/media-url/MediaUrlEntry";
import { reactChildren, reactText } from "../../../support/reactTestNodes";

const reactHookMocks = vi.hoisted(() => ({
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
  useRef: vi.fn(),
  useState: vi.fn(),
}));

const reportSystemFailure = vi.hoisted(() => vi.fn());

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: reactHookMocks.useEffect,
    useLayoutEffect: reactHookMocks.useLayoutEffect,
    useRef: reactHookMocks.useRef,
    useState: reactHookMocks.useState,
  };
});

vi.mock("@/shared/systemFailure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/shared/systemFailure")>();
  return { ...actual, reportSystemFailure };
});

type SubmitEvent = { preventDefault: () => void };
type TestElementProps = {
  children?: ReactNode;
  id?: string;
  name?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onSubmit?: (event: SubmitEvent) => Promise<void>;
  "aria-busy"?: boolean;
  "aria-label"?: string;
  "data-layout"?: string;
};
type TestElement = ReactElement<TestElementProps>;

const isElement = (node: ReactNode): node is TestElement => isValidElement<TestElementProps>(node);

const childNodes = (node: TestElement) => reactChildren(node);

const findElement = (
  node: ReactNode,
  predicate: (element: TestElement) => boolean,
): TestElement => {
  const findMatchingElement = (current: ReactNode): TestElement | undefined => {
    if (!isElement(current)) return undefined;
    if (predicate(current)) return current;
    for (const child of childNodes(current)) {
      const found = findMatchingElement(child);
      if (found) return found;
    }
    return undefined;
  };

  const found = findMatchingElement(node);
  if (found) return found;
  throw new Error("element not found");
};

const textContent = reactText;

const createHookHarness = () => {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  let stateCursor = 0;
  let refCursor = 0;

  reactHookMocks.useLayoutEffect.mockImplementation(() => undefined);
  reactHookMocks.useEffect.mockImplementation(() => undefined);
  reactHookMocks.useRef.mockImplementation(<Value,>(initial: Value) => {
    const index = refCursor++;
    refs[index] ??= { current: initial };
    return refs[index];
  });
  reactHookMocks.useState.mockImplementation(<Value,>(initial: Value | (() => Value)) => {
    const index = stateCursor++;
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
      stateCursor = 0;
      refCursor = 0;
      return module();
    },
  };
};

const changeInputValue = (tree: ReactNode, value: string) => {
  const input = findElement(tree, (element) => element.props.name === "media-url");
  input.props.onChange?.({ target: { value } });
};

function MediaUrlEntryHarness({
  layout,
  onUrlImport,
}: {
  layout: MediaUrlEntryLayout;
  onUrlImport: (sourceUrl: string) => void | Promise<void>;
}) {
  const controller = useMediaUrlEntryController(onUrlImport);
  return MediaUrlEntry({ layout, controller });
}

afterEach(() => vi.clearAllMocks());

describe("media URL entry", () => {
  it("submits a trimmed valid URL and retains one layout-aware DOM module", async () => {
    const hooks = createHookHarness();
    const onUrlImport = vi.fn(async () => undefined);
    const render = (layout: "landing" | "editor") =>
      hooks.render(() => MediaUrlEntryHarness({ layout, onUrlImport }));

    let tree = render("landing");
    changeInputValue(tree, "  https://soundcloud.com/user/track  ");
    tree = render("editor");

    expect(tree.props["data-layout"]).toBe("editor");
    const form = findElement(tree, (element) => element.type === "form");
    await form.props.onSubmit?.({
      preventDefault: vi.fn(),
    });

    expect(onUrlImport).toHaveBeenCalledWith("https://soundcloud.com/user/track");
  });

  it("keeps submission state accessible without rendering progress copy under the entry", async () => {
    const hooks = createHookHarness();
    let resolveImport!: () => void;
    const onUrlImport = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const render = () =>
      hooks.render(() => MediaUrlEntryHarness({ layout: "landing", onUrlImport }));

    let tree = render();
    changeInputValue(tree, "https://soundcloud.com/user/track");
    tree = render();
    const form = findElement(tree, (element) => element.type === "form");
    const submit = form.props.onSubmit?.({
      preventDefault: vi.fn(),
    });

    tree = render();
    const button = findElement(
      tree,
      (element) => element.props["aria-label"] === "start media import",
    );
    expect(button.props["aria-busy"]).toBe(true);
    expect(
      textContent(findElement(tree, (element) => element.props.id === "media-url-error")),
    ).toBe("");

    resolveImport();
    await submit;
  });

  it("keeps malformed URL feedback local to the input", async () => {
    const hooks = createHookHarness();
    const onUrlImport = vi.fn();
    const render = () =>
      hooks.render(() => MediaUrlEntryHarness({ layout: "landing", onUrlImport }));

    let tree = render();
    changeInputValue(tree, "not a url");
    tree = render();
    const form = findElement(tree, (element) => element.type === "form");
    await form.props.onSubmit?.({
      preventDefault: vi.fn(),
    });

    tree = render();
    expect(
      textContent(findElement(tree, (element) => element.props.id === "media-url-error")),
    ).toBe("enter a complete http or https url");
    expect(onUrlImport).not.toHaveBeenCalled();
    expect(reportSystemFailure).not.toHaveBeenCalled();
  });

  it("routes rejected system work through the shared reporter without local field copy", async () => {
    const hooks = createHookHarness();
    const failure = new Error("private upstream detail");
    const onUrlImport = vi.fn(async () => {
      throw failure;
    });
    const render = () =>
      hooks.render(() => MediaUrlEntryHarness({ layout: "editor", onUrlImport }));

    let tree = render();
    changeInputValue(tree, "https://youtube.com/watch?v=abc");
    tree = render();
    const form = findElement(tree, (element) => element.type === "form");
    await form.props.onSubmit?.({
      preventDefault: vi.fn(),
    });

    expect(reportSystemFailure).toHaveBeenCalledWith(failure, "import");
    tree = render();
    expect(
      textContent(findElement(tree, (element) => element.props.id === "media-url-error")),
    ).toBe("");
  });

  it("keeps a pre-queue unavailable-link rejection beside the submitted URL", async () => {
    const hooks = createHookHarness();
    const onUrlImport = vi.fn(async () => {
      throw new Error("soundcloud set request failed (404)");
    });
    const render = () =>
      hooks.render(() => MediaUrlEntryHarness({ layout: "landing", onUrlImport }));

    let tree = render();
    changeInputValue(tree, "https://soundcloud.com/user/sets/missing");
    tree = render();
    const form = findElement(tree, (element) => element.type === "form");
    await form.props.onSubmit?.({
      preventDefault: vi.fn(),
    });

    tree = render();
    expect(
      textContent(findElement(tree, (element) => element.props.id === "media-url-error")),
    ).toBe("check that the link is public and still available, then try again");
    expect(reportSystemFailure).not.toHaveBeenCalled();
  });
});
