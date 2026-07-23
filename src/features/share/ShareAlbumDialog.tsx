import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Music2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SharePublicationReceipt } from "@/features/share/shareClient";
import type { ShareAlbumPreview } from "@/features/share/sharePreview";

export type ShareDialogState =
  | { status: "closed" }
  | { status: "confirm"; preview: ShareAlbumPreview }
  | { status: "publishing"; preview: ShareAlbumPreview }
  | { status: "published"; preview: ShareAlbumPreview; receipt: SharePublicationReceipt }
  | { status: "error"; preview: ShareAlbumPreview; message: string };

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
  const copyTimerRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const open = state.status !== "closed";
  const receiptKey =
    state.status === "published" ? `${state.receipt.slug}:${state.receipt.expiresAt}` : null;

  useEffect(() => {
    setCopied(false);
    setConfirmStop(false);
    setStopError(null);
    setStopping(false);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }, [open, receiptKey]);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const cover = state.status === "closed" ? null : state.preview.cover;
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!cover) {
      setCoverUrl(null);
      return;
    }
    const url = URL.createObjectURL(cover.blob);
    setCoverUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);

  const copyLink = async () => {
    if (state.status !== "published") return;
    try {
      await navigator.clipboard.writeText(state.receipt.url);
    } catch {
      inputRef.current?.select();
      document.execCommand("copy");
    }
    setCopied(true);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copyTimerRef.current = null;
    }, 2_000);
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
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] max-w-lg gap-0 overflow-y-auto p-0"
      >
        {state.status !== "closed" && (
          <>
            <DialogHeader className="border-b px-5 py-4 pr-12">
              <DialogTitle className="truncate text-left">
                {state.status === "published"
                  ? "share link ready"
                  : `share album: ${state.preview.albumTitle}`}
              </DialogTitle>
            </DialogHeader>

            <SharePreview preview={state.preview} coverUrl={coverUrl} />

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
                <p className="text-sm text-muted-foreground">
                  Expires {formatExpiry(state.receipt.expiresAt)}. Stop sharing to revoke it
                  immediately.
                </p>
              </div>
            ) : (
              <div className="space-y-4 p-5">
                <p className="text-sm leading-6 text-foreground">
                  Anyone with the link can download these tracks with your tags.
                </p>
                <p className="text-sm text-muted-foreground">Expires in 90 days.</p>
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

const formatExpiry = (expiresAt: string) => {
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime()) ? "in 90 days" : `on ${date.toLocaleDateString()}`;
};

function SharePreview({
  preview,
  coverUrl,
}: {
  preview: ShareAlbumPreview;
  coverUrl: string | null;
}) {
  return (
    <div className="grid h-24 grid-cols-[96px_minmax(0,1fr)] gap-4 px-5 pt-5 sm:h-[136px] sm:grid-cols-[136px_minmax(0,1fr)]">
      <div
        className="flex h-full items-center justify-center overflow-hidden rounded-md bg-muted"
        aria-label={preview.cover ? "album cover" : "no album cover"}
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" className="size-full object-cover" />
        ) : (
          <Music2 className="size-8 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      <ol
        tabIndex={0}
        aria-label="track preview"
        className="h-full min-h-0 overflow-y-auto rounded-md border p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&>li+li]:mt-1"
      >
        {preview.tracks.length ? (
          preview.tracks.map((track, index) => (
            <li key={track.key} className="flex min-w-0 gap-2 leading-5" title={track.title}>
              <span className="w-5 shrink-0 text-right text-muted-foreground" aria-hidden="true">
                {index + 1}.
              </span>
              <span className="min-w-0 truncate">{track.title}</span>
            </li>
          ))
        ) : (
          <li className="list-none p-1 text-muted-foreground">No tracks</li>
        )}
      </ol>
    </div>
  );
}
