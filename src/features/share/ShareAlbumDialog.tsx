import { useRef, useState } from "react";
import { Check, Copy, Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SharePublicationReceipt } from "@/features/share/shareClient";

export type ShareDialogState =
  | { status: "closed" }
  | { status: "confirm"; albumTitle: string; trackCount: number; hasCover: boolean }
  | { status: "publishing"; albumTitle: string; trackCount: number; hasCover: boolean }
  | { status: "published"; albumTitle: string; receipt: SharePublicationReceipt }
  | { status: "error"; albumTitle: string; trackCount: number; hasCover: boolean; message: string };

export default function ShareAlbumDialog({
  state,
  onClose,
  onPublish,
  onStopSharing,
}: {
  state: ShareDialogState;
  onClose: () => void;
  onPublish: () => void;
  onStopSharing: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const open = state.status !== "closed";

  const copyLink = async () => {
    if (state.status !== "published") return;
    try {
      await navigator.clipboard.writeText(state.receipt.url);
    } catch {
      inputRef.current?.select();
      document.execCommand("copy");
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  };

  const stopSharing = async () => {
    setStopping(true);
    setStopError(null);
    try {
      await onStopSharing();
      setConfirmStop(false);
    } catch {
      setStopError("Sharing could not be stopped. Check your connection and try again.");
    } finally {
      setStopping(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && state.status !== "publishing" && !stopping) onClose();
      }}
    >
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        {state.status !== "closed" && (
          <>
            <DialogHeader className="border-b p-5">
              <div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-muted">
                <Share2 className="size-4" aria-hidden="true" />
              </div>
              <DialogTitle>
                {state.status === "published" ? "album shared" : `share ${state.albumTitle}`}
              </DialogTitle>
              <DialogDescription>
                {state.status === "published"
                  ? "Anyone with this link can review and download the album."
                  : `${state.trackCount} track${state.trackCount === 1 ? "" : "s"} will be shared from their original sources.`}
              </DialogDescription>
            </DialogHeader>

            {state.status === "published" ? (
              <div className="space-y-5 p-5">
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    readOnly
                    aria-label="share link"
                    value={state.receipt.url}
                    onFocus={(event) => event.currentTarget.select()}
                    className="min-w-0 font-mono text-xs"
                  />
                  <Button type="button" onClick={copyLink} className="shrink-0">
                    {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                    {copied ? "copied" : "copy link"}
                  </Button>
                </div>
                <p className="text-sm leading-6 text-muted-foreground">
                  This shared album expires in 90 days. Its cover art is retained until then. You
                  can stop sharing later from this browser.
                </p>
                <p className="text-xs text-muted-foreground">
                  Available until{" "}
                  {new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(
                    new Date(state.receipt.expiresAt),
                  )}
                  .
                </p>
              </div>
            ) : (
              <div className="space-y-4 p-5">
                <p className="text-sm leading-6 text-foreground">
                  The shared album keeps the tags you chose. Audio is not uploaded; each recipient
                  downloads it from the original sources on their device.
                </p>
                <p className="text-sm leading-6 text-foreground">
                  Only share sources you have permission to access and redistribute.
                </p>
                <div className="rounded-lg bg-muted p-4 text-sm leading-6 text-muted-foreground">
                  The shared album expires after 90 days.
                  {state.hasCover
                    ? " Its cover art will be retained until then."
                    : " No cover art will be stored."}
                </div>
                {state.status === "error" && (
                  <p role="alert" className="text-sm text-destructive">
                    {state.message}. Your album is unchanged.
                  </p>
                )}
              </div>
            )}

            <DialogFooter className="border-t p-5">
              {state.status === "published" ? (
                confirmStop ? (
                  <>
                    <p className="mr-auto text-left text-sm text-muted-foreground">
                      The link and cover will stop working immediately.
                      {stopError && (
                        <span role="alert" className="mt-1 block text-destructive">
                          {stopError}
                        </span>
                      )}
                    </p>
                    <Button type="button" variant="outline" onClick={() => setConfirmStop(false)}>
                      keep sharing
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={stopping}
                      onClick={() => void stopSharing()}
                    >
                      {stopping && <Loader2 className="animate-spin motion-reduce:animate-none" />}
                      stop sharing
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setConfirmStop(true)}
                    >
                      stop sharing
                    </Button>
                    <Button type="button" onClick={onClose}>
                      done
                    </Button>
                  </>
                )
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={state.status === "publishing"}
                    onClick={onClose}
                  >
                    cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={state.status === "publishing"}
                    onClick={onPublish}
                  >
                    {state.status === "publishing" && (
                      <Loader2 className="animate-spin motion-reduce:animate-none" />
                    )}
                    {state.status === "publishing" ? "creating link…" : "create share link"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
