import type { ShareAlbumActionState } from "@/features/share/sharePublication";

export type AlbumActionItemId = "edit" | "cleanup" | "share";

export interface AlbumActionInvocation {
  returnFocusTarget: HTMLButtonElement | null;
}

export interface AlbumActionItem {
  id: AlbumActionItemId;
  label: string;
  trailingText?: string;
  description?: string;
  disabled: boolean;
  onSelect: (invocation: AlbumActionInvocation) => void;
}

export function createAlbumActionItems({
  cleanupSuggestionCount,
  canShare,
  shareDisabledReason,
  shareLabel,
  onEdit,
  onReviewCleanup,
  onShare,
}: {
  cleanupSuggestionCount: number;
  canShare: boolean;
  shareDisabledReason: string;
  shareLabel: ShareAlbumActionState["label"];
  onEdit: () => void;
  onReviewCleanup: (invocation: AlbumActionInvocation) => void;
  onShare: () => void;
}): AlbumActionItem[] {
  return [
    {
      id: "edit",
      label: "edit album",
      disabled: false,
      onSelect: onEdit,
    },
    {
      id: "cleanup",
      label: "clean up tracks",
      trailingText:
        cleanupSuggestionCount === 0
          ? "none needed"
          : `${cleanupSuggestionCount} track${cleanupSuggestionCount === 1 ? "" : "s"}`,
      disabled: cleanupSuggestionCount === 0,
      onSelect: onReviewCleanup,
    },
    {
      id: "share",
      label: shareLabel,
      trailingText: canShare ? undefined : "unavailable",
      description: canShare ? undefined : shareDisabledReason,
      disabled: !canShare,
      onSelect: onShare,
    },
  ];
}
