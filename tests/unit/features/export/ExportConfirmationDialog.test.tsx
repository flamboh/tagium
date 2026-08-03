import type { ReactElement, ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import ExportConfirmationDialog, {
  ExportPlanDisclosure,
} from "@/features/export/ExportConfirmationDialog";
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

const plan = {
  target: { kind: "library" as const },
  groups: [
    {
      id: "album:one",
      title: "Album One",
      tracks: [{ id: "track", title: "A Track" }],
    },
  ],
  trackCount: 1,
  totalSizeBytes: 1_500,
};

const render = (overrides: Partial<Parameters<typeof ExportConfirmationDialog>[0]> = {}) =>
  ExportConfirmationDialog({
    plan,
    status: "ready",
    busy: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    onRestoreFocus: vi.fn(),
    ...overrides,
  });

describe("ExportConfirmationDialog", () => {
  it("shows only the locked manifest and approximate download copy", () => {
    const tree = render();
    const text = textContent(tree);
    expect(text).toContain("Download 1 track");
    expect(text).toContain("Download ~0.00 MB");
    expect(text).not.toMatch(/\bbytes?\b/i);
    expect(text).not.toMatch(/filename|format|artwork|path|setting/i);
    const disclosures = findAll(tree, (element) => element.type === ExportPlanDisclosure);
    expect(disclosures).toHaveLength(1);
    expect(disclosures[0]?.props.group).toMatchObject({ title: "Album One" });
  });

  it("keeps every group collapsed and keyboard-accessible", async () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ExportPlanDisclosure group={plan.groups[0]!} />);
    });
    const trigger = () => renderer.root.findByType("button");
    const region = () => renderer.root.findByProps({ role: "region" });
    expect(trigger().props["aria-expanded"]).toBe(false);
    expect(trigger().props["aria-controls"]).toBe(region().props.id);
    expect(region().props["aria-hidden"]).toBe(true);
    expect(region().props.inert).toBe(true);

    await act(() => trigger().props.onClick());
    expect(trigger().props["aria-expanded"]).toBe(true);
    expect(region().props["aria-hidden"]).toBe(false);
  });

  it("wires controls and locks every dismissal path while busy", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const ready = render({ onCancel, onConfirm });
    const buttons = findAll(ready, (element) => element.type === Button);
    const cancel = buttons.find((button) => textContent(button) === "Cancel");
    const confirm = buttons.find((button) => textContent(button).startsWith("Download"));
    (cancel?.props.onClick as (() => void) | undefined)?.();
    (confirm?.props.onClick as (() => void) | undefined)?.();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();

    const busy = render({ busy: true });
    const busyButtons = findAll(busy, (element) => element.type === Button);
    expect(busyButtons.every((button) => button.props.disabled === true)).toBe(true);
    expect(textContent(busy)).toContain("Preparing…");
    const content = findAll(busy, (element) => element.props["aria-busy"] === true)[0]!;
    const escapePrevent = vi.fn();
    const outsidePrevent = vi.fn();
    (content.props.onEscapeKeyDown as (event: { preventDefault: () => void }) => void)({
      preventDefault: escapePrevent,
    });
    (content.props.onInteractOutside as (event: { preventDefault: () => void }) => void)({
      preventDefault: outsidePrevent,
    });
    expect(escapePrevent).toHaveBeenCalledOnce();
    expect(outsidePrevent).toHaveBeenCalledOnce();
  });

  it("announces changed and unavailable states and disables stale confirmation", () => {
    const changed = render({ status: "changed" });
    expect(textContent(findAll(changed, (element) => element.props.role === "alert")[0])).toBe(
      "The download changed. Confirm the updated download again.",
    );

    const unavailable = render({ status: "unavailable" });
    expect(
      textContent(findAll(unavailable, (element) => element.props.role === "alert")[0]),
    ).toContain("no longer available");
    const confirm = findAll(unavailable, (element) => element.type === Button).find((button) =>
      textContent(button).startsWith("Download"),
    );
    expect(confirm?.props.disabled).toBe(true);
  });

  it("focuses Cancel, restores focus, and confines mobile scrolling to the manifest", () => {
    const onRestoreFocus = vi.fn();
    const tree = render({ onRestoreFocus });
    const content = findAll(
      tree,
      (element) => typeof element.props.onOpenAutoFocus === "function",
    )[0]!;
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
    expect(content.props.className).toContain("overflow-hidden");
    const manifest = findAll(
      tree,
      (element) => element.props["data-testid"] === "export-manifest",
    )[0];
    expect(manifest?.props.className).toContain("overflow-y-auto");
  });
});
