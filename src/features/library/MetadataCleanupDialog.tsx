import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MetadataCleanupSuggestion } from "@/features/library/metadataCleanup";

export interface MetadataCleanupDialogProps {
  open: boolean;
  suggestions: MetadataCleanupSuggestion[];
  onOpenChange: (open: boolean) => void;
  onApply: (suggestions: MetadataCleanupSuggestion[]) => void;
}

export default function MetadataCleanupDialog({
  open,
  suggestions,
  onOpenChange,
  onApply,
}: MetadataCleanupDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setSelectedIds(new Set(suggestions.map((suggestion) => suggestion.trackId)));
  }, [open, suggestions]);

  const selectedSuggestions = suggestions.filter((suggestion) =>
    selectedIds.has(suggestion.trackId),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(44rem,calc(100svh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle>track title clean up</DialogTitle>
          <DialogDescription>
            we found some noise in your track titles. keep the changes you like, deselect the ones
            you don't
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto border-y px-6">
          <div className="divide-y">
            {suggestions.map((suggestion) => (
              <label
                key={suggestion.trackId}
                className="flex cursor-pointer select-none items-start gap-3 py-4"
              >
                <Checkbox
                  checked={selectedIds.has(suggestion.trackId)}
                  onCheckedChange={() =>
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (next.has(suggestion.trackId)) next.delete(suggestion.trackId);
                      else next.add(suggestion.trackId);
                      return next;
                    })
                  }
                  className="mt-1"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="truncate text-sm text-foreground/70 line-through decoration-2 decoration-foreground/80">
                    {suggestion.beforeTitle}
                  </p>
                  <div className="flex min-w-0 items-center gap-2">
                    <ArrowRight className="size-3.5 shrink-0 text-primary" />
                    <p className="truncate text-sm font-medium">{suggestion.afterTitle}</p>
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
        <DialogFooter className="shrink-0 items-center justify-between px-6 py-4 sm:justify-between">
          <Button variant="ghost" onClick={() => setSelectedIds(new Set())}>
            clear all
          </Button>
          <Button
            disabled={selectedSuggestions.length === 0}
            onClick={() => onApply(selectedSuggestions)}
          >
            apply {selectedSuggestions.length} change{selectedSuggestions.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
