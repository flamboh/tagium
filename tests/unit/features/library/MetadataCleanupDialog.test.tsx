import type { FocusEvent, ReactNode } from "react";
import { Schema } from "effect";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import type { MetadataCleanupSuggestion } from "@/features/library/metadataCleanup";
import { buttonElementFixture } from "../../../support/domFixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogContent: ({
    children,
    onCloseAutoFocus,
  }: {
    children?: ReactNode;
    onCloseAutoFocus?: (event: { preventDefault: () => void }) => void;
  }) => {
    const handleBlur = (event: FocusEvent<HTMLDivElement>) => onCloseAutoFocus?.(event);
    return (
      <div data-dialog-content onBlur={handleBlur}>
        {children}
      </div>
    );
  },
  DialogDescription: ({ children }: { children?: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children?: ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children?: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: () => void }) => (
    <button data-checkbox aria-pressed={checked} onClick={onCheckedChange} />
  ),
}));

import MetadataCleanupDialog from "@/features/library/MetadataCleanupDialog";

const suggestion = (trackId: string): MetadataCleanupSuggestion => ({
  trackId,
  beforeTitle: `Artist - ${trackId}`,
  afterTitle: trackId,
  beforeFilename: `Artist - ${trackId}.mp3`,
  afterFilename: `${trackId}.mp3`,
  reasons: ["artist"],
});

const textContent = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (Schema.is(Schema.String)(child) ? child : textContent(child)))
    .join("");

describe("MetadataCleanupDialog", () => {
  it("keeps populated suggestions rendered while the dialog closes", () => {
    const props = {
      open: true,
      selectionSessionKey: 1,
      suggestions: [suggestion("one"), suggestion("two")],
      returnFocusTarget: null,
      onOpenChange: vi.fn(),
      onApply: vi.fn(),
    };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<MetadataCleanupDialog {...props} />);
    });

    act(() => {
      renderer!.update(<MetadataCleanupDialog {...props} open={false} suggestions={[]} />);
    });

    expect(textContent(renderer!.root)).toContain("apply 2 changes");
    expect(textContent(renderer!.root)).not.toContain("nothing left to clean up");
    act(() => renderer!.unmount());
  });

  it("preserves equivalent unchecked choices live and resets them on a new session", () => {
    const onApply = vi.fn();
    const props = {
      open: true,
      selectionSessionKey: 1,
      suggestions: [suggestion("one"), suggestion("two")],
      returnFocusTarget: null,
      onOpenChange: vi.fn(),
      onApply,
    };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<MetadataCleanupDialog {...props} />);
    });

    const checkboxes = renderer!.root.findAllByProps({ "data-checkbox": true });
    void act(() => checkboxes[0].props.onClick());
    act(() => {
      renderer!.update(
        <MetadataCleanupDialog {...props} suggestions={[suggestion("one"), suggestion("two")]} />,
      );
    });
    const apply = renderer!.root
      .findAllByType("button")
      .find((button) => textContent(button).startsWith("apply "));
    void act(() => apply!.props.onClick());
    expect(onApply).toHaveBeenCalledWith([expect.objectContaining({ trackId: "two" })]);

    act(() => {
      renderer!.update(<MetadataCleanupDialog {...props} selectionSessionKey={2} />);
    });
    const reopenedApply = renderer!.root
      .findAllByType("button")
      .find((button) => textContent(button).startsWith("apply "));
    expect(reopenedApply && textContent(reopenedApply)).toBe("apply 2 changes");
    act(() => renderer!.unmount());
  });

  it("names an album, explains an empty live state, and restores menu focus on close", () => {
    const focus = vi.fn();
    const returnFocusTarget = buttonElementFixture(focus);
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <MetadataCleanupDialog
          open
          selectionSessionKey={1}
          suggestions={[]}
          albumTitle="Untrue"
          returnFocusTarget={returnFocusTarget}
          onOpenChange={vi.fn()}
          onApply={vi.fn()}
        />,
      );
    });

    expect(textContent(renderer!.root)).toContain("review suggested title changes for Untrue");
    expect(textContent(renderer!.root)).toContain("nothing left to clean up");
    const content = renderer!.root.findByProps({ "data-dialog-content": true });
    const preventDefault = vi.fn();
    void act(() => content.props.onBlur({ preventDefault }));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
    act(() => renderer!.unmount());
  });
});
