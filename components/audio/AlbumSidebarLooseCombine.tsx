"use client";

import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { SidebarDragData, SidebarDropData } from "./AlbumSidebarDnd";

export interface LooseCombineTarget {
  sourceTrackId: string;
  targetTrackId: string;
}

const COMBINE_DELAY_MS = 300;

export const looseCombineTargetId = (targetTrackId: string) => `combine:loose:${targetTrackId}`;

const isSameTarget = (left: LooseCombineTarget | null, right: LooseCombineTarget | null) =>
  Boolean(left) &&
  Boolean(right) &&
  left?.sourceTrackId === right?.sourceTrackId &&
  left?.targetTrackId === right?.targetTrackId;

export function looseCombineTargetFromDrag(
  active: SidebarDragData | undefined,
  over: SidebarDropData | undefined,
) {
  if (active?.type !== "track") return null;
  if (active.container !== "loose") return null;
  if (over?.type !== "track") return null;
  if (over.container !== "loose") return null;
  if (over.trackId === active.trackId) return null;
  return { sourceTrackId: active.trackId, targetTrackId: over.trackId };
}

export function useLooseCombineTarget() {
  const [target, setTarget] = useState<LooseCombineTarget | null>(null);
  const pendingTargetRef = useRef<LooseCombineTarget | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    pendingTargetRef.current = null;
    setTarget(null);
  };

  const queue = (nextTarget: LooseCombineTarget | null) => {
    if (!nextTarget) {
      clear();
      return;
    }
    if (isSameTarget(target, nextTarget)) return;
    if (isSameTarget(pendingTargetRef.current, nextTarget)) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    pendingTargetRef.current = nextTarget;
    setTarget(null);
    timeoutRef.current = setTimeout(() => {
      setTarget(nextTarget);
      pendingTargetRef.current = null;
      timeoutRef.current = null;
    }, COMBINE_DELAY_MS);
  };

  return { clear, queue, target };
}

export function LooseCombineDropTarget({ target }: { target: LooseCombineTarget }) {
  const { isOver, setNodeRef } = useDroppable({
    id: looseCombineTargetId(target.targetTrackId),
    data: {
      type: "combine",
      sourceTrackId: target.sourceTrackId,
      targetTrackId: target.targetTrackId,
    } satisfies SidebarDropData,
  });

  return (
    <div className="px-2 py-1" ref={setNodeRef}>
      <div
        className={cn(
          "flex min-h-10 items-center justify-center rounded-md border border-dashed border-primary/60 bg-primary/5 px-3 text-xs font-medium text-primary transition-shadow",
          isOver ? "shadow-[inset_0_0_0_2px_var(--primary)]" : "",
        )}
      >
        create album with these 2 tracks
      </div>
    </div>
  );
}
