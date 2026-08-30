import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

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
    expect(findAll(changed, (element) => element.props.role === "alert")).toHaveLength(1);

    const unavailable = render({ status: "unavailable" });
    expect(findAll(unavailable, (element) => element.props.role === "alert")).toHaveLength(1);
    const confirm = findAll(unavailable, (element) => element.type === Button).find((button) =>
      textContent(button).startsWith("download"),
    );
    expect(confirm?.props.disabled).toBe(true);
  });

  it("focuses cancel and restores focus when the dialog closes", () => {
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
  });
});
