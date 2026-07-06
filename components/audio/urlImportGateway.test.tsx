import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import audioDownloaderSource from "./AudioDownloader.tsx?raw";
import AudioDownloader from "./AudioDownloader";
import landingScreenSource from "./LandingScreen.tsx?raw";
import LandingScreen from "./LandingScreen";

const reactHookMocks = vi.hoisted(() => ({
  useRef: vi.fn(),
  useState: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: reactHookMocks.useRef,
    useState: reactHookMocks.useState,
  };
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
  let stateCursor = 0;

  reactHookMocks.useRef.mockImplementation((initial: unknown) => ({ current: initial }));
  reactHookMocks.useState.mockImplementation((initial: unknown) => {
    const index = stateCursor++;
    if (!(index in states)) {
      states[index] = typeof initial === "function" ? initial() : initial;
    }

    return [
      states[index],
      (next: unknown) => {
        states[index] = typeof next === "function" ? next(states[index]) : next;
      },
    ];
  });

  return {
    render<T>(component: () => T) {
      stateCursor = 0;
      return component();
    },
  };
};

const changeInputValue = (tree: ReactNode, name: string, value: string) => {
  const input = findElement(tree, (element) => element.props.name === name);
  const onChange = input.props.onChange as (event: { target: { value: string } }) => void;
  onChange({ target: { value } });
};

const flushImportRejection = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("URL import gateway components", () => {
  it("keeps URL classification out of the import UI components", () => {
    const sources = [audioDownloaderSource, landingScreenSource];

    for (const source of sources) {
      expect(source).toContain("onUrlImport");
      expect(source).not.toContain("onAudioDownload");
      expect(source).not.toContain("onSoundCloudSetDownload");
      expect(source).not.toContain("isSoundCloudSetUrl");
      expect(source).not.toContain("resolveSoundCloudSet");
    }
  });

  it("AudioDownloader calls onUrlImport with a trimmed URL and shows rejected imports", async () => {
    const hooks = createHookHarness();
    const onUrlImport = vi.fn(async () => {
      throw new Error("import denied");
    });
    const render = () => hooks.render(() => AudioDownloader({ onUrlImport }));

    let tree = render();
    changeInputValue(tree, "media-url", "  https://soundcloud.com/user/track  ");

    tree = render();
    const button = findElement(
      tree,
      (element) => element.props["aria-label"] === "start media import",
    );
    const onClick = button.props.onClick as () => void;
    onClick();
    await flushImportRejection();

    expect(onUrlImport).toHaveBeenCalledTimes(1);
    expect(onUrlImport).toHaveBeenCalledWith("https://soundcloud.com/user/track");

    tree = render();
    const error = findElement(tree, (element) => element.props["aria-live"] === "polite");
    expect(textContent(error)).toBe("import denied");
  });

  it("LandingScreen calls onUrlImport with a trimmed URL and shows rejected imports", async () => {
    const hooks = createHookHarness();
    const onUrlImport = vi.fn(async () => {
      throw new Error("import denied");
    });
    const render = () =>
      hooks.render(() => LandingScreen({ onAudioUpload: () => {}, onUrlImport }));

    let tree = render();
    changeInputValue(tree, "landing-media-url", "  https://youtube.com/watch?v=abc  ");

    tree = render();
    const form = findElement(tree, (element) => element.type === "form");
    const onSubmit = form.props.onSubmit as (event: {
      preventDefault: () => void;
    }) => Promise<void>;
    await onSubmit({ preventDefault: vi.fn() });

    expect(onUrlImport).toHaveBeenCalledTimes(1);
    expect(onUrlImport).toHaveBeenCalledWith("https://youtube.com/watch?v=abc");

    tree = render();
    const error = findElement(tree, (element) => element.props["aria-live"] === "polite");
    expect(textContent(error)).toBe("import denied");
  });
});
