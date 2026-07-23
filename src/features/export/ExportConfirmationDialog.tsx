import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatMegabyteSize,
  type ExportConfirmationGroup,
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

export function ExportConfirmationDisclosure({
  group,
}: {
  group: ExportConfirmationGroup;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <div className="group/disclosure px-3 py-2.5" data-state={open ? "open" : "closed"}>
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-3 rounded-sm text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{group.title}</span>
          <span className="text-xs text-muted-foreground">
            {group.tracks.length} {group.tracks.length === 1 ? "track" : "tracks"}
          </span>
        </span>
        <ChevronDown
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out group-data-[state=open]/disclosure:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </button>
      <div
        id={contentId}
        role="region"
        aria-label={`${group.title} tracks`}
        aria-hidden={!open}
        inert={!open}
        className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-200 ease-out group-data-[state=open]/disclosure:grid-rows-[1fr] group-data-[state=open]/disclosure:opacity-100 motion-reduce:transition-none"
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="mt-2 space-y-1 border-t pt-2">
            {group.tracks.map((track) => (
              <li key={track.id} className="min-w-0 truncate text-xs">
                {track.title}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
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
  const downloadLabel = summary ? `Download ${formatMegabyteSize(summary.totalSizeBytes)}` : "Download";

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
            Download {summary?.trackCount ?? 0} {noun}
          </DialogTitle>
          {status !== "ready" && (
            <p
              role="alert"
              className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground"
            >
              {status === "changed"
                ? "Your export changed. Confirm the updated download again."
                : "Your export changed and some files are no longer ready. Close this dialog and try again."}
            </p>
          )}
        </DialogHeader>

        {summary && (
          <div className="min-h-0 overflow-y-auto -mx-2 px-2" data-testid="export-summary">
            <div className="divide-y rounded-md border">
              {summary.groups.map((group) => (
                <ExportConfirmationDisclosure key={group.id} group={group} />
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
            className="w-[10.5rem] justify-center tabular-nums"
          >
            {busy ? "preparing download..." : downloadLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
