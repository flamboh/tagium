import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatByteSize,
  type ExportConfirmationSummary,
} from "@/features/export/exportConfirmation";

export interface ExportConfirmationDialogProps {
  summary: ExportConfirmationSummary | null;
  status: "ready" | "changed" | "unavailable";
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  onRestoreFocus: () => void;
}

export default function ExportConfirmationDialog({
  summary,
  status,
  busy,
  onCancel,
  onConfirm,
  onRestoreFocus,
}: ExportConfirmationDialogProps) {
  const noun = summary?.trackCount === 1 ? "track" : "tracks";

  return (
    <Dialog open={Boolean(summary)} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] p-4 sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:p-6"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const content = event.currentTarget as HTMLElement;
          content.querySelector<HTMLElement>("[data-export-cancel]")?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}
        onPointerDownOutside={(event) => busy && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            download {summary?.trackCount ?? 0} {noun}?
          </DialogTitle>
          <DialogDescription>
            Review the files before Tagium applies metadata and creates the download.
          </DialogDescription>
          {status !== "ready" && (
            <p
              role="status"
              className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground"
            >
              {status === "changed"
                ? "Your export changed. Review the updated files and confirm again."
                : "Your export changed and some files are no longer ready. Close this dialog and try again."}
            </p>
          )}
        </DialogHeader>

        {summary && (
          <div className="min-h-0 overflow-y-auto -mx-2 px-2" data-testid="export-summary">
            <div className="mb-3 flex items-baseline justify-between gap-4 rounded-md bg-muted px-3 py-2.5 text-sm">
              <span className="font-medium">estimated download size</span>
              <span className="text-right tabular-nums text-muted-foreground">
                {formatByteSize(summary.totalSizeBytes)}
              </span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Current file bytes before metadata updates and ZIP compression.
            </p>
            <div className="divide-y rounded-md border">
              {summary.groups.map((group) => (
                <details key={group.id} className="group px-3 py-2.5">
                  <summary className="cursor-pointer select-none list-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className="flex items-start justify-between gap-4 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{group.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {group.tracks.length} {group.tracks.length === 1 ? "track" : "tracks"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatByteSize(group.sizeBytes)}
                      </span>
                    </span>
                  </summary>
                  <ul className="mt-2 space-y-1 border-t pt-2" aria-label={`${group.title} tracks`}>
                    {group.tracks.map((track) => (
                      <li key={track.id} className="flex justify-between gap-4 text-xs">
                        <span className="min-w-0 truncate">{track.title}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatByteSize(track.sizeBytes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={busy}
            data-export-cancel
          >
            cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy || status === "unavailable"}
            aria-busy={busy}
          >
            {busy ? "preparing download..." : "download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
