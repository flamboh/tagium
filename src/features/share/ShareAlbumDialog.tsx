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
  | { status: "confirm"; preview: ShareAlbumPreview; intent?: "create" | "update" }
  | { status: "publishing"; preview: ShareAlbumPreview; intent?: "create" | "update" }
  | {
      status: "published";
      preview: ShareAlbumPreview;
      receipt: SharePublicationReceipt;
    }
  | {
      status: "link";
      preview: ShareAlbumPreview;
      url: string;
    }
  | {
      status: "error";
      preview: ShareAlbumPreview;
      intent?: "create" | "update";
      message: string;
    };

interface ShareAlbumDialogProps {
  state: ShareDialogState;
  onClose: () => void;
  onPublish: () => void;
  onStopSharing: () => Promise<void>;
}

export default function ShareAlbumDialog(props: ShareAlbumDialogProps) {
  if (props.state.status === "closed") return null;
  return <ShareAlbumDialogSession {...props} state={props.state} />;
}

function ShareAlbumDialogSession({
  state,
  onClose,
  onPublish,
  onStopSharing,
}: Omit<ShareAlbumDialogProps, "state"> & {
  state: Exclude<ShareDialogState, { status: "closed" }>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "manual">("idle");
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const open = true;
  const dialogView =
    state.status === "published" || state.status === "link" ? "share-link" : "share-creator";
  const linkUrl =
    state.status === "published"
      ? state.receipt.url
      : state.status === "link"
        ? state.url
        : undefined;

  const closeDialog = () => {
    setCopyStatus("idle");
    setConfirmStop(false);
    setStopError(null);
    setStopping(false);
    if (copyTimerRef.current !== null) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    onClose();
  };

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const cover = state.preview.cover;
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
    if (!linkUrl) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(linkUrl);
      setCopyStatus("copied");
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopyStatus("manual");
    }
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => {
      setCopyStatus("idle");
      copyTimerRef.current = null;
    }, 3_000);
  };

  const stopSharing = async () => {
    setStopping(true);
    setStopError(null);
    try {
      await onStopSharing();
      setConfirmStop(false);
    } catch {
      setStopError("sharing could not be stopped. check your connection and try again.");
    } finally {
      setStopping(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && state.status !== "publishing" && !stopping) closeDialog();
      }}
    >
      <DialogContent
        contentKey={dialogView}
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] max-w-lg gap-0 overflow-y-auto p-0"
        showCloseButton={state.status !== "publishing" && !stopping}
      >
        <>
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle className="truncate text-left">
              {`share album: ${state.preview.albumTitle}`}
            </DialogTitle>
          </DialogHeader>

          <SharePreview preview={state.preview} coverUrl={coverUrl} />

          {state.status === "published" || state.status === "link" ? (
            <div className="space-y-2 px-5 py-4">
              <div className="flex min-h-5 items-center justify-between gap-3">
                <label htmlFor="album-share-link" className="text-sm font-medium">
                  share link
                </label>
                <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
                  {copyStatus === "manual" ? "select and copy the link" : null}
                </span>
              </div>
              <div className="flex gap-2">
                <Input
                  id="album-share-link"
                  ref={inputRef}
                  readOnly
                  value={linkUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-w-0 font-mono text-xs"
                />
                <Button type="button" onClick={copyLink} className="h-9 w-32 shrink-0">
                  {copyStatus === "copied" ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
                  {copyStatus === "copied" ? "copied" : "copy link"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 px-5 pb-4 pt-1">
              <p className="text-sm leading-6 text-foreground">
                anyone with the link can add this album. tracks are added from their original
                sources with these shared tags.
              </p>
              <p className="text-sm text-muted-foreground">
                {state.intent === "update"
                  ? "the link keeps its current expiration."
                  : "expires in 90 days."}
              </p>
              {state.status === "error" && (
                <p role="alert" className="text-sm text-destructive">
                  {state.message}
                </p>
              )}
            </div>
          )}

          {state.status === "published" && (
            <div className="px-5 pb-4 text-left text-sm text-muted-foreground">
              {confirmStop ? (
                <>
                  the link will stop working immediately. anyone who already added the album keeps
                  their copy.
                  {stopError && (
                    <span role="alert" className="mt-1 block text-destructive">
                      {stopError}
                    </span>
                  )}
                </>
              ) : (
                `expires ${formatExpiry(
                  state.receipt.expiresAt,
                )} · stop sharing to turn the link off at any time`
              )}
            </div>
          )}

          <DialogFooter className="border-t p-4">
            {state.status === "published" ? (
              <div className="grid w-full grid-cols-2 gap-2">
                <div className="min-w-0">
                  {confirmStop ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 w-full"
                      onClick={() => setConfirmStop(false)}
                    >
                      keep sharing
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-9 w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setConfirmStop(true)}
                    >
                      stop sharing
                    </Button>
                  )}
                </div>
                {confirmStop ? (
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-9 w-full"
                    disabled={stopping}
                    onClick={() => void stopSharing()}
                  >
                    {stopping && (
                      <Loader2
                        aria-hidden="true"
                        className="animate-spin motion-reduce:animate-none"
                      />
                    )}
                    stop sharing
                  </Button>
                ) : (
                  <Button type="button" className="h-9 w-full" onClick={closeDialog}>
                    done
                  </Button>
                )}
              </div>
            ) : state.status === "link" ? (
              <Button type="button" className="h-9 w-full" onClick={closeDialog}>
                done
              </Button>
            ) : (
              <div className="grid w-full grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full"
                  disabled={state.status === "publishing"}
                  onClick={closeDialog}
                >
                  cancel
                </Button>
                <Button
                  type="button"
                  className="h-9 w-full"
                  disabled={state.status === "publishing"}
                  onClick={onPublish}
                >
                  {state.status === "publishing" && (
                    <Loader2
                      aria-hidden="true"
                      className="animate-spin motion-reduce:animate-none"
                    />
                  )}
                  {state.status === "publishing"
                    ? state.intent === "update"
                      ? "updating shared album…"
                      : "creating link…"
                    : state.intent === "update"
                      ? "update shared album"
                      : "create share link"}
                </Button>
              </div>
            )}
          </DialogFooter>
        </>
      </DialogContent>
    </Dialog>
  );
}

const formatExpiry = (expiresAt: string) => {
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime())
    ? "in 90 days"
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
};

function SharePreview({
  preview,
  coverUrl,
}: {
  preview: ShareAlbumPreview;
  coverUrl: string | null;
}) {
  return (
    <div className="flex min-w-0 gap-4 px-5 py-4">
      <div
        className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted sm:size-32"
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
        className="h-24 min-w-0 flex-1 overflow-x-hidden overflow-y-auto rounded-md border p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-32 [&>li+li]:mt-1"
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
          <li className="list-none p-1 text-muted-foreground">no tracks</li>
        )}
      </ol>
    </div>
  );
}
