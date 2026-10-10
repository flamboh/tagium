import { Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TagSidebarPanelProps } from "@/features/library/TagSidebarPanel";
import { useLiveTrackFilenameValidity } from "@/features/library/trackFilenamePreview";
import { cn } from "@/lib/utils";

type FooterProps = Pick<
  TagSidebarPanelProps,
  "files" | "filenamePreviewStore" | "loading" | "settingsOpen" | "onDownloadAll" | "onOpenSettings"
>;

export default function TagSidebarFooter({
  files,
  filenamePreviewStore,
  loading,
  settingsOpen,
  onDownloadAll,
  onOpenSettings,
}: FooterProps) {
  const hasValidFilename = useLiveTrackFilenameValidity(filenamePreviewStore);
  const hasInvalidFilename = files.some((file) => file.metadata && !hasValidFilename(file));

  const canDownloadAll =
    files.length > 0 && files.every((file) => Boolean(file.file) && hasValidFilename(file));

  const downloadAllReason = loading
    ? "download in progress"
    : files.length === 0
      ? "add tracks first"
      : hasInvalidFilename
        ? "every track needs a filename"
        : "tracks need files and metadata";

  return (
    <div className="px-3 py-3 border-t flex-shrink-0 flex flex-col gap-2">
      {canDownloadAll && !loading ? (
        <Button className="w-full [@media(pointer:coarse)]:min-h-11" onClick={onDownloadAll}>
          download all
        </Button>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block">
              <Button
                className="w-full [@media(pointer:coarse)]:min-h-11"
                onClick={onDownloadAll}
                disabled
              >
                {loading ? "downloading..." : "download all"}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{downloadAllReason}</TooltipContent>
        </Tooltip>
      )}
      <Button
        variant="outline"
        data-export-focus-fallback
        className={cn(
          "h-auto w-full flex-col justify-center gap-1 py-3 text-center",
          settingsOpen &&
            "border-transparent bg-accent text-accent-foreground shadow-none hover:bg-accent",
        )}
        onClick={onOpenSettings}
      >
        <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} />
        settings
      </Button>
    </div>
  );
}
