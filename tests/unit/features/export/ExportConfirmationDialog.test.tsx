import type { ReactElement, ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import ExportConfirmationDialog from "@/features/export/ExportConfirmationDialog";
import { Button } from "@/components/ui/button";

type TestElement = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
const isElement = (node: ReactNode): node is TestElement =>
  typeof node === "object" && node !== null && "props" in node;
const childrenOf = (node: TestElement): ReactNode[] => {
  const children = node.props.children;
  if (children === undefined || children === null || typeof children === "boolean") return [];
  return Array.isArray(children) ? children : [children];
};
const findAll = (node: ReactNode, predicate: (element: TestElement) => boolean): TestElement[] => {
  if (!isElement(node)) return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...childrenOf(node).flatMap((child) => findAll(child, predicate)),
  ];
};
const textContent = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isElement(node)) return "";
  return childrenOf(node).map(textContent).join("");
};

const summary = {
  target: { kind: "library" as const },
  groups: [
    {
      id: "album:one",
      title: "Album One",
      tracks: [{ id: "track", title: "A Track", sizeBytes: 1_500 }],
      sizeBytes: 1_500,
    },
  ],
  trackCount: 1,
  totalSizeBytes: 1_500,
  fingerprint: "fingerprint",
};

describe("ExportConfirmationDialog", () => {
  it("renders grouped exact sizes and expandable track details", () => {
    const tree = ExportConfirmationDialog({
      summary,
      status: "ready",
      busy: false,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      onRestoreFocus: vi.fn(),
    });

    expect(textContent(tree)).toContain("download 1 track?");
    expect(textContent(tree)).toContain("Album One");
    expect(textContent(tree)).toContain("1.5 kB (1,500 bytes)");
    expect(textContent(tree)).toContain("estimated download size");
    expect(textContent(tree)).toContain("Current file bytes");
    expect(findAll(tree, (element) => element.type === "details")).toHaveLength(1);
    expect(textContent(tree)).toContain("A Track");
  });

  it("wires cancel and confirm and locks both controls while busy", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const readyTree = ExportConfirmationDialog({
      summary,
      status: "ready",
      busy: false,
      onCancel,
      onConfirm,
      onRestoreFocus: vi.fn(),
    });
    const readyButtons = findAll(readyTree, (element) => element.type === Button);
    const cancel = readyButtons.find((button) => textContent(button) === "cancel");
    const confirm = readyButtons.find((button) => textContent(button) === "download");
    expect(cancel).toBeDefined();
    expect(confirm).toBeDefined();
    (cancel?.props.onClick as (() => void) | undefined)?.();
    (confirm?.props.onClick as (() => void) | undefined)?.();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();

    const busyTree = ExportConfirmationDialog({
      summary,
      status: "ready",
      busy: true,
      onCancel,
      onConfirm,
      onRestoreFocus: vi.fn(),
    });
    const busyButtons = findAll(busyTree, (element) => element.type === Button);
    expect(busyButtons.every((button) => button.props.disabled === true)).toBe(true);
    expect(textContent(busyTree)).toContain("preparing download...");
  });

  it("announces stale state and prevents an unavailable export", () => {
    const tree = ExportConfirmationDialog({
      summary,
      status: "unavailable",
      busy: false,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      onRestoreFocus: vi.fn(),
    });
    const alert = findAll(tree, (element) => element.props.role === "alert")[0];
    expect(textContent(alert)).toContain("no longer ready");
    expect(alert?.props["aria-live"]).toBeUndefined();
    const download = findAll(tree, (element) => element.type === Button).find((button) =>
      textContent(button).includes("download"),
    );
    expect(download?.props.disabled).toBe(true);
  });

  it("focuses cancel, restores the initiating control, and constrains mobile scrolling", () => {
    const onRestoreFocus = vi.fn();
    const tree = ExportConfirmationDialog({
      summary,
      status: "ready",
      busy: false,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      onRestoreFocus,
    });
    const content = findAll(
      tree,
      (element) => typeof element.props.onOpenAutoFocus === "function",
    )[0];
    if (!content) throw new Error("dialog content not found");
    const focus = vi.fn();
    const preventOpen = vi.fn();
    (content.props.onOpenAutoFocus as (event: unknown) => void)({
      preventDefault: preventOpen,
      currentTarget: { querySelector: () => ({ focus }) },
    });
    expect(preventOpen).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();

    const preventClose = vi.fn();
    (content.props.onCloseAutoFocus as (event: unknown) => void)({ preventDefault: preventClose });
    expect(preventClose).toHaveBeenCalledOnce();
    expect(onRestoreFocus).toHaveBeenCalledOnce();
    expect(content.props.className).toContain("max-h-[calc(100dvh-1rem)]");
    const scrollArea = findAll(
      tree,
      (element) => element.props["data-testid"] === "export-summary",
    )[0];
    expect(scrollArea?.props.className).toContain("overflow-y-auto");
  });

  it("allows Escape while idle but blocks Escape and outside dismissal while busy", () => {
    const render = (busy: boolean) =>
      ExportConfirmationDialog({
        summary,
        status: "ready",
        busy,
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
        onRestoreFocus: vi.fn(),
      });
    const content = (tree: ReactNode) =>
      findAll(tree, (element) => typeof element.props.onEscapeKeyDown === "function")[0];
    const idlePrevent = vi.fn();
    const idleContent = content(render(false));
    if (!idleContent) throw new Error("idle dialog content not found");
    (idleContent.props.onEscapeKeyDown as (event: unknown) => void)({
      preventDefault: idlePrevent,
    });
    expect(idlePrevent).not.toHaveBeenCalled();

    const escapePrevent = vi.fn();
    const outsidePrevent = vi.fn();
    const busyContent = content(render(true));
    if (!busyContent) throw new Error("busy dialog content not found");
    (busyContent.props.onEscapeKeyDown as (event: unknown) => void)({
      preventDefault: escapePrevent,
    });
    (busyContent.props.onPointerDownOutside as (event: unknown) => void)({
      preventDefault: outsidePrevent,
    });
    expect(escapePrevent).toHaveBeenCalledOnce();
    expect(outsidePrevent).toHaveBeenCalledOnce();
  });
});
