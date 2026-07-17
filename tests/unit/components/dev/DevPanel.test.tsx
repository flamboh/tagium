import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DevPanel } from "@/components/dev/DevPanel";

const reactHookMocks = vi.hoisted(() => ({
  useCallback: vi.fn(),
  useEffect: vi.fn(),
  useRef: vi.fn(),
  useState: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useCallback: reactHookMocks.useCallback,
    useEffect: reactHookMocks.useEffect,
    useRef: reactHookMocks.useRef,
    useState: reactHookMocks.useState,
  };
});

type TestElement = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
type EffectSetup = () => void | (() => void);

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

const createHookHarness = () => {
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  let stateCursor = 0;
  let refCursor = 0;
  let effect: EffectSetup | undefined;

  reactHookMocks.useCallback.mockImplementation((callback: unknown) => callback);
  reactHookMocks.useEffect.mockImplementation((setup: EffectSetup) => {
    effect = setup;
  });
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
    render() {
      stateCursor = 0;
      refCursor = 0;
      return DevPanel();
    },
    runEffect() {
      if (!effect) throw new Error("effect not registered");
      return effect();
    },
  };
};

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const config = (windowMs: number) => ({
  enabled: true,
  deployEnv: "local",
  detectedFrom: "test",
  productionBranch: "main",
  rateLimit: {
    windowMs,
    maxRequests: 60,
    bucketCount: 0,
    client: { key: "test", count: 0, remaining: 60 },
  },
  faults: {},
});

const response = (body: unknown, ok = true) =>
  ({ ok, json: vi.fn(async () => body) }) as unknown as Response;

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const refreshButton = (tree: ReactNode) =>
  findElement(tree, (element) => element.props["aria-label"] === "refresh dev config");

const windowInput = (tree: ReactNode) =>
  findElement(tree, (element) => element.props.type === "number" && element.props.step === 1000);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("DevPanel config loading", () => {
  it("aborts the discarded StrictMode request and ignores its stale result", async () => {
    const first = createDeferred<Response>();
    const second = createDeferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal("fetch", fetchMock);
    const hooks = createHookHarness();

    expect(hooks.render()).toBeNull();
    const cleanup = hooks.runEffect();
    expect(typeof cleanup).toBe("function");
    cleanup?.();
    hooks.runEffect();

    const firstSignal = (fetchMock.mock.calls[0][1] as RequestInit).signal;
    expect(firstSignal?.aborted).toBe(true);

    second.resolve(response(config(2_000)));
    await flushPromises();
    first.resolve(response(config(1_000)));
    await flushPromises();

    expect(windowInput(hooks.render()).props.value).toBe("2000");
  });

  it("makes the latest manual refresh win and aborts the superseded request", async () => {
    const firstRefresh = createDeferred<Response>();
    const latestRefresh = createDeferred<Response>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(config(1_000)))
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => latestRefresh.promise);
    vi.stubGlobal("fetch", fetchMock);
    const hooks = createHookHarness();

    hooks.render();
    hooks.runEffect();
    await flushPromises();
    const button = refreshButton(hooks.render());

    (button.props.onClick as () => void)();
    (button.props.onClick as () => void)();

    const firstRefreshSignal = (fetchMock.mock.calls[1][1] as RequestInit).signal;
    expect(firstRefreshSignal?.aborted).toBe(true);

    latestRefresh.resolve(response(config(3_000)));
    await flushPromises();
    firstRefresh.resolve(response(config(2_000)));
    await flushPromises();

    expect(windowInput(hooks.render()).props.value).toBe("3000");
  });

  it("does not update after cleanup even when fetch ignores abort", async () => {
    const pending = createDeferred<Response>();
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => pending.promise);
    vi.stubGlobal("fetch", fetchMock);
    const hooks = createHookHarness();

    hooks.render();
    const cleanup = hooks.runEffect();
    cleanup?.();
    pending.resolve(response(config(1_000)));
    await flushPromises();

    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(hooks.render()).toBeNull();
  });

  it("keeps the last successful config when a manual refresh rejects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(config(1_000)))
      .mockRejectedValueOnce(new TypeError("network unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const hooks = createHookHarness();

    hooks.render();
    hooks.runEffect();
    await flushPromises();
    const button = refreshButton(hooks.render());
    (button.props.onClick as () => void)();
    await flushPromises();

    expect(windowInput(hooks.render()).props.value).toBe("1000");
  });

  it("keeps non-OK dev config responses as a hidden null panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(undefined, false)),
    );
    const hooks = createHookHarness();

    hooks.render();
    hooks.runEffect();
    await flushPromises();

    expect(hooks.render()).toBeNull();
  });
});
