import type { ShareActionState } from "@/features/share/sharePublication";

export type TrackActionItemId = "retry" | "share" | "remove";

export interface TrackActionItem {
  id: TrackActionItemId;
  label: string;
  description?: string;
  disabled: boolean;
  shareVariant?: ShareActionState["variant"];
  destructive?: boolean;
  onSelect: () => void;
}

export function createTrackActionItems({
  retryable,
  canShare,
  shareDisabledReason,
  shareLabel,
  shareVariant,
  onRetry,
  onShare,
  onRemove,
}: {
  retryable: boolean;
  canShare: boolean;
  shareDisabledReason: string;
  shareLabel: ShareActionState["label"];
  shareVariant: ShareActionState["variant"];
  onRetry: () => void;
  onShare: () => void;
  onRemove: () => void;
}): TrackActionItem[] {
  return [
    ...(retryable
      ? [
          {
            id: "retry" as const,
            label: "retry download",
            disabled: false,
            onSelect: onRetry,
          },
        ]
      : []),
    {
      id: "share",
      label: shareLabel,
      description: canShare ? undefined : shareDisabledReason,
      disabled: !canShare,
      shareVariant,
      onSelect: onShare,
    },
    {
      id: "remove",
      label: "remove track",
      disabled: false,
      destructive: true,
      onSelect: onRemove,
    },
  ];
}
