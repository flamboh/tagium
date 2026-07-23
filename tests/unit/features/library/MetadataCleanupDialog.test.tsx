import type { ReactNode } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import type { MetadataCleanupSuggestion } from "@/features/library/metadataCleanup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
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

const textContent = (node: ReactTestInstance) =>
  node.children.filter((child): child is string => typeof child === "string").join("");

describe("MetadataCleanupDialog", () => {
  it("preserves unchecked suggestions when an unrelated library update recomputes them", () => {
    const onApply = vi.fn();
    const props = {
      open: true,
      selectionSessionKey: 1,
      suggestions: [suggestion("one"), suggestion("two")],
      onOpenChange: vi.fn(),
      onApply,
    };
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<MetadataCleanupDialog {...props} />);
    });

    const checkboxes = renderer!.root.findAllByProps({ "data-checkbox": true });
    void act(() => checkboxes[0].props.onClick());
    expect(checkboxes[0].props["aria-pressed"]).toBe(false);

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
      renderer!.update(
        <MetadataCleanupDialog
          {...props}
          selectionSessionKey={2}
          suggestions={[suggestion("one"), suggestion("two")]}
        />,
      );
    });
    const reopenedApply = renderer!.root
      .findAllByType("button")
      .find((button) => textContent(button).startsWith("apply "));
    expect(reopenedApply && textContent(reopenedApply)).toBe("apply 2 changes");
    act(() => renderer!.unmount());
  });
});
