"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AlbumSidebarEmptyState({ onAddAlbum }: { onAddAlbum: () => void }) {
  return (
    <div className="w-full flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground px-4">
      <p>no tracks yet</p>
      <p className="text-xs">create an empty album or upload tracks</p>
      <Button type="button" variant="outline" size="sm" onClick={onAddAlbum}>
        <Plus className="h-4 w-4" />
        add album
      </Button>
    </div>
  );
}
