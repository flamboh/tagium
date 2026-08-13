import { isValidElement, type ReactElement, type ReactNode } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import { Schema } from "effect";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}));

import ExportConfirmationDialog, {
  ExportConfirmationDialogView,
  ExportPlanDisclosure,
} from "@/features/export/ExportConfirmationDialog";
import { Button } from "@/components/ui/button";
import { reactChildren, reactText } from "../../../support/reactTestNodes";

type FocusEventFixture = {
  preventDefault: () => void;
  currentTarget?: { querySelector: () => { focus: () => void } };
};
type TestElementProps = {
  children?: ReactNode;
  group?: (typeof plan.groups)[number];
  disabled?: boolean;
  role?: string;
  className?: string;
  id?: string;
  inert?: boolean;
  "aria-busy"?: boolean;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "aria-hidden"?: boolean;
  "data-testid"?: string;
  onClick?: () => void;
  onEscapeKeyDown?: (event: FocusEventFixture) => void;
  onInteractOutside?: (event: FocusEventFixture) => void;
  onOpenAutoFocus?: (event: FocusEventFixture) => void;
  onCloseAutoFocus?: (event: FocusEventFixture) => void;
};
type TestElement = ReactElement<TestElementProps>;
const isElement = (node: ReactNode): node is TestElement => isValidElement<TestElementProps>(node);
const childrenOf = (node: TestElement): ReactNode[] => reactChildren(node);
const findAll = (node: ReactNode, predicate: (element: TestElement) => boolean): TestElement[] => {
  if (!isElement(node)) return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...childrenOf(node).flatMap((child) => findAll(child, predicate)),
  ];
};
const textContent = reactText;
const renderedText = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (Schema.is(Schema.String)(child) ? child : renderedText(child)))
    .join("");

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
  ExportConfirmationDialogView({
    plan,
    status: "ready",
    busy: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    onRestoreFocus: vi.fn(),
    open: true,
    ...overrides,
  });

describe("ExportConfirmationDialog", () => {
  it("keeps the populated plan rendered while the dialog closes", () => {
    const props = {
      plan,
      status: "ready" as const,
      busy: false,
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
      onRestoreFocus: vi.fn(),
    };
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ExportConfirmationDialog {...props} />);
    });

    act(() => renderer.update(<ExportConfirmationDialog {...props} plan={null} />));

    expect(renderedText(renderer.root)).toContain("download 1 track");
    expect(renderedText(renderer.root)).not.toContain("download 0 tracks");
    act(() => renderer.unmount());
  });

  it("shows only the locked manifest and approximate download copy", () => {
    const tree = render();
    const text = textContent(tree);
    expect(text).toContain("download 1 track");
    expect(text).toContain("download ~0.00 mb");
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
    const cancel = buttons.find((button) => textContent(button) === "cancel");
    const confirm = buttons.find((button) => textContent(button).startsWith("download"));
    (cancel?.props.onClick as (() => void) | undefined)?.();
    (confirm?.props.onClick as (() => void) | undefined)?.();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).toHaveBeenCalledOnce();

    const busy = render({ busy: true });
    const busyButtons = findAll(busy, (element) => element.type === Button);
    expect(busyButtons.every((button) => button.props.disabled === true)).toBe(true);
    expect(textContent(busy)).toContain("preparing…");
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
      "the download changed. confirm the updated download again.",
    );

    const unavailable = render({ status: "unavailable" });
    expect(
      textContent(findAll(unavailable, (element) => element.props.role === "alert")[0]),
    ).toContain("no longer available");
    const confirm = findAll(unavailable, (element) => element.type === Button).find((button) =>
      textContent(button).startsWith("download"),
    );
    expect(confirm?.props.disabled).toBe(true);
  });

  it("focuses cancel, restores focus, and confines mobile scrolling to the manifest", () => {
    const onRestoreFocus = vi.fn();
    const tree = render({ onRestoreFocus });
    const content = findAll(tree, (element) => element.props.onOpenAutoFocus !== undefined)[0]!;
    const focus = vi.fn();
    const preventOpen = vi.fn();
    content.props.onOpenAutoFocus?.({
      preventDefault: preventOpen,
      currentTarget: { querySelector: () => ({ focus }) },
    });
    expect(preventOpen).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();

    const preventClose = vi.fn();
    content.props.onCloseAutoFocus?.({ preventDefault: preventClose });
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
