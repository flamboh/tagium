import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import audioTaggerSource from "./audioTagger.tsx?raw";
import landingScreenSource from "./LandingScreen.tsx?raw";
import mediaUrlEntrySource from "./MediaUrlEntry.tsx?raw";
import MediaUrlEntry from "./MediaUrlEntry";

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

vi.mock("./systemFailure", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./systemFailure")>();
  return { ...actual, reportSystemFailure };
});

type TestElement = ReactElement<Record<string, unknown> & { children?: ReactNode }>;

const isElement = (node: ReactNode): node is TestElement =>
  typeof node === "object" && node !== null && "props" in node;

const childNodes = (node: TestElement) => {
  const { children } = node.props;
  if (children === undefined || children === null || typeof children === "boolean") return [];
  return Array.isArray(children) ? children : [children];
};

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

const textContent = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isElement(node)) return "";
  return childNodes(node).map(textContent).join("");
};

const createHookHarness = () => {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  let stateCursor = 0;
  let refCursor = 0;

  reactHookMocks.useLayoutEffect.mockImplementation(() => undefined);
  reactHookMocks.useEffect.mockImplementation(() => undefined);
  reactHookMocks.useRef.mockImplementation((initial: unknown) => {
    const index = refCursor++;
    refs[index] ??= { current: initial };
    return refs[index];
  });
  reactHookMocks.useState.mockImplementation((initial: unknown) => {
    const index = stateCursor++;
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
      stateCursor = 0;
      refCursor = 0;
      return module();
    },
  };
};

const changeInputValue = (tree: ReactNode, value: string) => {
  const input = findElement(tree, (element) => element.props.name === "media-url");
  const onChange = input.props.onChange as (event: { target: { value: string } }) => void;
  onChange({ target: { value } });
};

afterEach(() => vi.clearAllMocks());

describe("media URL entry", () => {
  it("is rendered once outside the landing/editor choice", () => {
    expect(audioTaggerSource.match(/<MediaUrlEntry/g)).toHaveLength(1);
    expect(audioTaggerSource).not.toContain("<AudioDownloader");
    expect(mediaUrlEntrySource).toContain("onUrlImport");
    expect(mediaUrlEntrySource).not.toContain("isSoundCloudSetUrl");
    expect(mediaUrlEntrySource).not.toContain("resolveSoundCloudSet");
  });

  it("keeps the URL entry in the centered landing stack instead of pinning it to the bottom", () => {
    expect(landingScreenSource).toContain("{children}");
    expect(mediaUrlEntrySource).not.toContain("bottom-[clamp(");
  });

  it("submits a trimmed valid URL and retains one layout-aware DOM module", async () => {
    const hooks = createHookHarness();
    const onUrlImport = vi.fn(async () => undefined);
    const render = (layout: "landing" | "editor") =>
      hooks.render(() => MediaUrlEntry({ layout, hidden: false, onUrlImport }));

    let tree = render("landing");
    changeInputValue(tree, "  https://soundcloud.com/user/track  ");
    tree = render("editor");

    expect(tree.props["data-layout"]).toBe("editor");
    const form = findElement(tree, (element) => element.type === "form");
    await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
      preventDefault: vi.fn(),
    });

    expect(onUrlImport).toHaveBeenCalledWith("https://soundcloud.com/user/track");
  });

  it("keeps malformed URL feedback local to the input", async () => {
    const hooks = createHookHarness();
    const onUrlImport = vi.fn();
    const render = () =>
      hooks.render(() => MediaUrlEntry({ layout: "landing", hidden: false, onUrlImport }));

    let tree = render();
    changeInputValue(tree, "not a url");
    tree = render();
    const form = findElement(tree, (element) => element.type === "form");
    await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
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
      hooks.render(() => MediaUrlEntry({ layout: "editor", hidden: false, onUrlImport }));

    let tree = render();
    changeInputValue(tree, "https://youtube.com/watch?v=abc");
    tree = render();
    const form = findElement(tree, (element) => element.type === "form");
    await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
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
      hooks.render(() => MediaUrlEntry({ layout: "landing", hidden: false, onUrlImport }));

    let tree = render();
    changeInputValue(tree, "https://soundcloud.com/user/sets/missing");
    tree = render();
    const form = findElement(tree, (element) => element.type === "form");
    await (form.props.onSubmit as (event: { preventDefault: () => void }) => Promise<void>)({
      preventDefault: vi.fn(),
    });

    tree = render();
    expect(
      textContent(findElement(tree, (element) => element.props.id === "media-url-error")),
    ).toBe("check that the link is public and still available, then try again");
    expect(reportSystemFailure).not.toHaveBeenCalled();
  });
});
