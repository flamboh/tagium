import { useEffect, useRef, useState } from "react";
import { Copy01Icon, MusicNote04Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { loaderCircleIcon } from "@/components/icons/loaderCircle";
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
import type { SharePreview } from "@/features/share/sharePreview";

export type ShareDialogState =
  | { status: "closed" }
  | { status: "confirm"; preview: SharePreview; intent?: "create" | "update" }
  | { status: "publishing"; preview: SharePreview; intent?: "create" | "update" }
  | {
      status: "published";
      preview: SharePreview;
      receipt: SharePublicationReceipt;
    }
  | {
      status: "link";
      preview: SharePreview;
      url: string;
    }
  | {
      status: "error";
      preview: SharePreview;
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
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const open = true;

  const targetName = state.preview.kind;
  const dismissible = state.status !== "publishing" && !stopping;

  const closeDialog = () => {
    setConfirmStop(false);
    setStopError(null);
    setStopping(false);
    onClose();
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
        if (!nextOpen && dismissible) closeDialog();
      }}
    >
      <DialogContent
        contentKey={
          state.status === "published" || state.status === "link" ? "share-link" : "share-creator"
        }
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] max-w-lg gap-0 overflow-y-auto p-0"
        showCloseButton={dismissible}
      >
        <>
          <DialogHeader className="min-w-0 border-b px-5 py-4 pr-12">
            <DialogTitle className="truncate text-left">
              {`share ${targetName}: ${state.preview.title}`}
            </DialogTitle>
          </DialogHeader>

          <SharePreview preview={state.preview} />

          {state.status === "published" || state.status === "link" ? (
            <ShareLinkField url={state.status === "published" ? state.receipt.url : state.url} />
          ) : (
            <ShareCreatorDetails state={state} />
          )}

          {state.status === "published" && (
            <PublishedShareNote
              expiresAt={state.receipt.expiresAt}
              confirmStop={confirmStop}
              stopError={stopError}
            />
          )}

          <DialogFooter className="border-t p-4">
            <ShareDialogFooterActions
              state={state}
              targetName={targetName}
              confirmStop={confirmStop}
              stopping={stopping}
              onConfirmStopChange={setConfirmStop}
              onStopSharing={() => void stopSharing()}
              onClose={closeDialog}
              onPublish={onPublish}
            />
          </DialogFooter>
        </>
      </DialogContent>
    </Dialog>
  );
}

function ShareLinkField({ url }: { url: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "manual">("idle");

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const copyLink = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(url);
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

  return (
    <div className="space-y-2 px-5 py-4">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <label htmlFor="share-link" className="text-sm font-medium">
          share link
        </label>
        <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
          {copyStatus === "manual" ? "select and copy the link" : null}
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          id="share-link"
          ref={inputRef}
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 font-mono text-xs"
        />
        <Button type="button" onClick={copyLink} className="h-9 w-32 shrink-0">
          {copyStatus === "copied" ? (
            <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} aria-hidden="true" />
          ) : (
            <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} aria-hidden="true" />
          )}
          {copyStatus === "copied" ? "copied" : "copy link"}
        </Button>
      </div>
    </div>
  );
}

function ShareCreatorDetails({
  state,
}: {
  state: Extract<ShareDialogState, { status: "confirm" | "publishing" | "error" }>;
}) {
  return (
    <div className="space-y-2 px-5 pb-4 pt-1">
      <p className="text-sm leading-6 text-foreground">
        {state.preview.kind === "album"
          ? "anyone with the link can add this album. tracks are added from their original sources with these shared tags."
          : "anyone with the link can add this track. it is downloaded from its original source with these shared tags."}
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
  );
}

function PublishedShareNote({
  expiresAt,
  confirmStop,
  stopError,
}: {
  expiresAt: string;
  confirmStop: boolean;
  stopError: string | null;
}) {
  return (
    <div className="px-5 pb-4 text-left text-sm text-muted-foreground">
      {confirmStop ? (
        <>
          the link will stop working immediately.
          {stopError && (
            <span role="alert" className="mt-1 block text-destructive">
              {stopError}
            </span>
          )}
        </>
      ) : (
        `expires ${formatExpiry(expiresAt)} · stop sharing to turn the link off at any time`
      )}
    </div>
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

function SharePreview({ preview }: { preview: SharePreview }) {
  const cover = preview.cover;
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

  return (
    <div className="flex min-w-0 gap-4 px-5 py-4">
      <div
        className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted sm:size-32"
        aria-label={
          preview.cover
            ? `${preview.kind} ${preview.kind === "album" ? "cover" : "artwork"}`
            : `no ${preview.kind} ${preview.kind === "album" ? "cover" : "artwork"}`
        }
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" className="size-full object-cover" />
        ) : (
          <HugeiconsIcon
            icon={MusicNote04Icon}
            strokeWidth={2}
            className="size-8 text-muted-foreground"
            aria-hidden="true"
          />
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

function ShareDialogFooterActions({
  state,
  targetName,
  confirmStop,
  stopping,
  onConfirmStopChange,
  onStopSharing,
  onClose,
  onPublish,
}: {
  state: Exclude<ShareDialogState, { status: "closed" }>;
  targetName: SharePreview["kind"];
  confirmStop: boolean;
  stopping: boolean;
  onConfirmStopChange: (confirmStop: boolean) => void;
  onStopSharing: () => void;
  onClose: () => void;
  onPublish: () => void;
}) {
  if (state.status === "published") {
    return (
      <div className="grid w-full grid-cols-2 gap-2">
        <div className="min-w-0">
          {confirmStop ? (
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full"
              onClick={() => onConfirmStopChange(false)}
            >
              keep sharing
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="h-9 w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onConfirmStopChange(true)}
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
            onClick={onStopSharing}
          >
            {stopping && (
              <HugeiconsIcon
                icon={loaderCircleIcon}
                strokeWidth={2}
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            )}
            stop sharing
          </Button>
        ) : (
          <Button type="button" className="h-9 w-full" onClick={onClose}>
            done
          </Button>
        )}
      </div>
    );
  }

  if (state.status === "link") {
    return (
      <Button type="button" className="h-9 w-full" onClick={onClose}>
        done
      </Button>
    );
  }

  const publishing = state.status === "publishing";
  const updating = state.intent === "update";

  return (
    <div className="grid w-full grid-cols-2 gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-9 w-full"
        disabled={publishing}
        onClick={onClose}
      >
        cancel
      </Button>
      <Button type="button" className="h-9 w-full" disabled={publishing} onClick={onPublish}>
        {publishing && (
          <HugeiconsIcon
            icon={loaderCircleIcon}
            strokeWidth={2}
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        )}
        {publishing
          ? updating
            ? `updating shared ${targetName}…`
            : "creating link…"
          : updating
            ? `update shared ${targetName}`
            : "create share link"}
      </Button>
    </div>
  );
}
