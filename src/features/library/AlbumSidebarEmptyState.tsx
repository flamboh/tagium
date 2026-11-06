"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { T, useGT } from "gt-react";
import { Button } from "@/components/ui/button";

export function AlbumSidebarEmptyState({
  onAddAlbum,
  onClearSelection,
}: {
  onAddAlbum: () => void;
  onClearSelection: () => void;
}) {
  const gt = useGT();

  return (
    <div className="relative w-full flex-1 min-h-0">
      <button
        type="button"
        tabIndex={-1}
        aria-label={gt("clear track selection and return to editor")}
        className="absolute inset-0 cursor-default"
        onClick={onClearSelection}
      />
      <div className="pointer-events-none relative flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
        <T>
          <p>no tracks yet</p>
          <p className="text-xs">create an empty album or upload tracks</p>
        </T>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="pointer-events-auto"
          onClick={onAddAlbum}
        >
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="h-4 w-4" />
          <T>add album</T>
        </Button>
      </div>
    </div>
  );
}
