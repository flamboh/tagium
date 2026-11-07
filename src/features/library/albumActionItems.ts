import { msg } from "gt-react";
import type { ShareActionState } from "@/features/share/sharePublication";

export type AlbumActionItemId = "edit" | "cleanup" | "share" | "delete";

export interface AlbumActionInvocation {
  returnFocusTarget: HTMLButtonElement | null;
}

export interface AlbumActionItem {
  id: AlbumActionItemId;
  label: string;
  cleanupSuggestionCount?: number;
  description?: string;
  disabled: boolean;
  destructive?: boolean;
  shareVariant?: ShareActionState["variant"];
  onSelect: (invocation: AlbumActionInvocation) => void;
}

export function createAlbumActionItems({
  cleanupSuggestionCount,
  canShare,
  shareDisabledReason,
  shareLabel,
  shareVariant,
  onEdit,
  onReviewCleanup,
  onShare,
  onDelete,
}: {
  cleanupSuggestionCount: number;
  canShare: boolean;
  shareDisabledReason: string;
  shareLabel: ShareActionState["label"];
  shareVariant: ShareActionState["variant"];
  onEdit: () => void;
  onReviewCleanup: (invocation: AlbumActionInvocation) => void;
  onShare: () => void;
  onDelete: (invocation: AlbumActionInvocation) => void;
}): AlbumActionItem[] {
  return [
    {
      id: "edit",
      label: msg("edit album"),
      disabled: false,
      onSelect: onEdit,
    },
    {
      id: "cleanup",
      label: msg("clean up tracks"),
      cleanupSuggestionCount,
      disabled: cleanupSuggestionCount === 0,
      onSelect: onReviewCleanup,
    },
    {
      id: "share",
      label: shareLabel,
      description: canShare ? undefined : shareDisabledReason,
      disabled: !canShare,
      shareVariant,
      onSelect: onShare,
    },
    {
      id: "delete",
      label: msg("delete album"),
      disabled: false,
      destructive: true,
      onSelect: onDelete,
    },
  ];
}
