import { useEffect, useState } from "react";
import { ExternalLink, ImageOff, Library, Loader2, Music2, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sharedArtworkUrl } from "@/features/share/shareClient";
import type { Manifest, ManifestTrack } from "@/features/share/shareManifest";
import { shareLinkForSlug } from "@/features/share/shareLink";

export type SharedAlbumPageState =
  | { status: "loading"; slug: string }
  | {
      status: "unavailable";
      slug: string;
      reason: "unavailable" | "newer-version";
    }
  | { status: "ready"; slug: string; manifest: Manifest; expiresAt: string };

type ReadySharedAlbumPageState = Extract<SharedAlbumPageState, { status: "ready" }>;

const skeletonRows = ["one", "two", "three", "four", "five", "six"] as const;

function Header({
  canStopSharing = false,
  onOpenTagium,
  onStop,
}: {
  canStopSharing?: boolean;
  onOpenTagium: () => void;
  onStop?: () => void;
}) {
  return (
    <header className="h-14 border-b">
      <div className="mx-auto flex h-full w-full max-w-3xl items-center gap-3 px-5 sm:px-8">
        <a
          href="/"
          className="rounded-sm text-xl font-bold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onOpenTagium();
          }}
        >
          tagium
        </a>
        {canStopSharing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={onStop}
          >
            stop sharing
          </Button>
        )}
      </div>
    </header>
  );
}

function SharedAlbumSkeleton({ onOpenTagium }: { onOpenTagium: () => void }) {
  return (
    <div className="min-h-svh bg-background">
      <Header onOpenTagium={onOpenTagium} />
      <main
        aria-busy="true"
        aria-label="opening shared album"
        className="mx-auto w-full max-w-3xl px-5 pb-10 pt-9 sm:px-8 sm:pt-12"
      >
        <div className="mb-5 h-4 w-56 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="flex items-start gap-6 max-sm:gap-4">
          <div className="size-40 shrink-0 animate-pulse rounded-xl bg-muted motion-reduce:animate-none max-sm:size-24" />
          <div className="w-full space-y-3 py-1">
            <div className="h-8 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none max-sm:h-7" />
            <div className="h-5 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
            <div className="h-4 w-28 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
        </div>
        <div className="mt-7 h-10 w-full max-w-lg animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="mt-5 h-10 w-40 animate-pulse rounded-md bg-muted motion-reduce:animate-none max-sm:w-full" />
        <div className="mt-10">
          <div className="mb-3 h-5 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="overflow-hidden rounded-lg border">
            {skeletonRows.map((row) => (
              <div
                key={row}
                className="flex min-h-14 items-center gap-3 border-b px-4 last:border-b-0"
              >
                <div className="h-4 w-5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        </div>
        <span className="sr-only">opening shared album…</span>
      </main>
    </div>
  );
}

function Artwork({ slug, title }: { slug: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div className="flex size-40 shrink-0 flex-col items-center justify-center gap-2 rounded-xl bg-muted text-center text-xs text-muted-foreground max-sm:size-24">
        <ImageOff className="size-6" aria-hidden="true" />
        <span className="max-sm:sr-only">cover art unavailable</span>
      </div>
    );
  return (
    <img
      src={sharedArtworkUrl(slug)}
      alt={`${title} cover`}
      className="size-40 shrink-0 rounded-xl object-cover ring-1 ring-border/60 max-sm:size-24"
      onError={() => setFailed(true)}
    />
  );
}

function AlbumHero({ manifest, slug }: { manifest: Manifest; slug: string }) {
  const title = manifest.album.title || "untitled album";
  const sourceLabel = manifest.album.sourceUrl
    ? new URL(manifest.album.sourceUrl).hostname.replace(/^www\./, "")
    : null;
  return (
    <section className="flex items-start gap-6 max-sm:gap-4">
      {manifest.album.artwork ? (
        <Artwork slug={slug} title={manifest.album.title} />
      ) : (
        <div className="flex size-40 shrink-0 items-center justify-center rounded-xl bg-muted max-sm:size-24">
          <Music2 className="size-9 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">no cover art</span>
        </div>
      )}
      <div className="min-w-0 py-1">
        <h1 className="break-words text-3xl font-semibold tracking-tight [overflow-wrap:anywhere] max-sm:text-xl">
          {title}
        </h1>
        <p className="mt-2 text-lg text-muted-foreground max-sm:text-sm">
          {manifest.album.artist || "unknown artist"}
        </p>
        {manifest.album.sourceUrl && sourceLabel && (
          <a
            href={manifest.album.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`from ${sourceLabel} (opens in a new tab)`}
          >
            from {sourceLabel}
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
    </section>
  );
}

function TrackList({
  tracks,
  albumArtist,
}: {
  tracks: readonly ManifestTrack[];
  albumArtist: string;
}) {
  const occurrences = new Map<string, number>();
  const rows = tracks.map((track, index) => {
    const identity = JSON.stringify(track);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { track, index, key: `${identity}:${occurrence}` };
  });
  return (
    <section className="mt-8" aria-labelledby="shared-track-list-title">
      <h2 id="shared-track-list-title" className="mb-3 text-sm font-semibold">
        {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
      </h2>
      <ol className="overflow-hidden rounded-lg border">
        {rows.map(({ track, index, key }) => {
          const trackArtist = track.metadata.artist.trim();
          const showArtist = trackArtist.length > 0 && trackArtist !== albumArtist.trim();
          return (
            <li
              key={key}
              className="flex min-h-14 items-center gap-3 border-b px-4 py-2.5 last:border-b-0"
            >
              <span className="w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                  {track.metadata.title || "untitled track"}
                </p>
                {showArtist && (
                  <p className="mt-0.5 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {trackArtist}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function AnotherTabToast({ slug, anotherTabOpen }: { slug: string; anotherTabOpen: boolean }) {
  useEffect(() => {
    if (!anotherTabOpen) return;
    const link = shareLinkForSlug(slug);
    const copyShareLink = async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast.success("share link copied");
      } catch {
        toast.error("copy failed", {
          description: `copy this link and paste it in the other tab: ${link}`,
        });
      }
    };
    const timeout = globalThis.setTimeout(() => {
      toast(
        "tagium is already open in another tab. copy the link and add the album there instead.",
        {
          duration: 12_000,
          action: {
            label: "copy link",
            onClick: () => void copyShareLink(),
          },
        },
      );
    }, 1_500);
    return () => globalThis.clearTimeout(timeout);
  }, [anotherTabOpen, slug]);

  return null;
}

function formatExpiry(expiresAt: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
    .format(new Date(expiresAt))
    .toLowerCase();
}

function RecipientContext({ trackCount, expiresAt }: { trackCount: number; expiresAt: string }) {
  const noun = trackCount === 1 ? "track" : "tracks";
  return (
    <p className="mb-5 text-sm text-muted-foreground">
      shared album · {trackCount} {noun} · link expires {formatExpiry(expiresAt)}
    </p>
  );
}

function AddingExplanation() {
  return (
    <p className="mt-7 max-w-lg text-sm leading-6 text-muted-foreground">
      adding downloads each track from its original source with the shared tags.
    </p>
  );
}

function StopSharingDialog({
  open,
  onOpenChange,
  stopping,
  stopError,
  onStop,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stopping: boolean;
  stopError: string | null;
  onStop: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>stop sharing this album?</DialogTitle>
          <DialogDescription>
            the link will stop working immediately. anyone who already added the album keeps their
            copy.
          </DialogDescription>
          {stopError && (
            <p role="alert" className="text-sm text-destructive">
              {stopError}
            </p>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            keep sharing
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="w-32 min-w-[7rem] justify-center"
            disabled={stopping}
            onClick={onStop}
          >
            {stopping && (
              <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            )}
            stop sharing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionBar({
  alreadyAddedAlbumId,
  adding,
  primaryLabel,
  onAdd,
  onViewAlbum,
}: {
  alreadyAddedAlbumId: string | null;
  adding: boolean;
  primaryLabel: string;
  onAdd: (allowDuplicate?: boolean) => void;
  onViewAlbum: () => void;
}) {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-2">
      <div className="flex shrink-0 items-center gap-4 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
        <Button
          type="button"
          className="h-10 w-40 justify-center max-sm:w-full"
          disabled={adding}
          onClick={alreadyAddedAlbumId ? onViewAlbum : () => onAdd()}
        >
          {adding ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : alreadyAddedAlbumId ? (
            <Library aria-hidden="true" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          {adding ? "adding album…" : primaryLabel}
        </Button>
        {alreadyAddedAlbumId && (
          <Button
            type="button"
            variant="link"
            className="h-10 px-0 max-sm:self-center"
            onClick={() => onAdd(true)}
            disabled={adding}
          >
            add another copy
          </Button>
        )}
      </div>
    </div>
  );
}

function SharedAlbumReadyPage({
  state,
  anotherTabOpen,
  alreadyAddedAlbumId,
  adding,
  canStopSharing,
  onOpenTagium,
  onAdd,
  onViewAlbum,
  onStopSharing,
}: {
  state: ReadySharedAlbumPageState;
  anotherTabOpen: boolean;
  alreadyAddedAlbumId: string | null;
  adding: boolean;
  canStopSharing: boolean;
  onBack: () => void;
  onOpenTagium: () => void;
  onAdd: (allowDuplicate?: boolean) => void;
  onViewAlbum: () => void;
  onStopSharing: () => Promise<void>;
}) {
  const [showStopConfirmation, setShowStopConfirmation] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const { manifest, slug } = state;
  const primaryLabel = alreadyAddedAlbumId ? "open in tagium" : "add to library";
  const stopSharing = async () => {
    setStopping(true);
    setStopError(null);
    try {
      await onStopSharing();
      setShowStopConfirmation(false);
    } catch {
      setStopError("sharing could not be stopped. check your connection and try again.");
    } finally {
      setStopping(false);
    }
  };
  const setStopDialogOpen = (open: boolean) => {
    setShowStopConfirmation(open);
    if (!open) {
      setStopError(null);
      setStopping(false);
    }
  };
  return (
    <div className="min-h-svh bg-background">
      <Header
        canStopSharing={canStopSharing}
        onOpenTagium={onOpenTagium}
        onStop={() => setShowStopConfirmation(true)}
      />
      <main className="mx-auto w-full max-w-3xl px-5 pb-10 pt-9 sm:px-8 sm:pt-12">
        <RecipientContext trackCount={manifest.tracks.length} expiresAt={state.expiresAt} />
        <AlbumHero manifest={manifest} slug={slug} />
        <AddingExplanation />
        <ActionBar
          alreadyAddedAlbumId={alreadyAddedAlbumId}
          adding={adding}
          primaryLabel={primaryLabel}
          onAdd={onAdd}
          onViewAlbum={onViewAlbum}
        />
        <AnotherTabToast slug={slug} anotherTabOpen={anotherTabOpen} />
        <TrackList tracks={manifest.tracks} albumArtist={manifest.album.artist} />
      </main>
      <StopSharingDialog
        open={showStopConfirmation}
        onOpenChange={setStopDialogOpen}
        stopping={stopping}
        stopError={stopError}
        onStop={() => void stopSharing()}
      />
    </div>
  );
}

export default function SharedAlbumPage(props: {
  state: SharedAlbumPageState;
  workspaceTrackCount: number;
  anotherTabOpen: boolean;
  alreadyAddedAlbumId: string | null;
  adding: boolean;
  canStopSharing: boolean;
  onBack: () => void;
  onOpenTagium: () => void;
  onAdd: (allowDuplicate?: boolean) => void;
  onViewAlbum: () => void;
  onStopSharing: () => Promise<void>;
}) {
  if (props.state.status === "loading")
    return <SharedAlbumSkeleton onOpenTagium={props.onOpenTagium} />;
  if (props.state.status === "unavailable") {
    const newerVersion = props.state.reason === "newer-version";
    return (
      <div className="min-h-svh bg-background">
        <Header onOpenTagium={props.onOpenTagium} />
        <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-3xl items-center px-5 py-10 sm:px-8">
          <div className="py-16">
            <div className="mb-5 flex size-11 items-center justify-center rounded-lg bg-muted">
              {newerVersion ? (
                <RotateCcw className="size-5" aria-hidden="true" />
              ) : (
                <Music2 className="size-5" aria-hidden="true" />
              )}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {newerVersion
                ? "this link needs a newer version of tagium"
                : "this shared album is no longer available"}
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              {newerVersion
                ? "reload the page to update, then open the link again. the album has not been added."
                : "the link may have expired, or sharing was stopped."}
            </p>
          </div>
        </main>
      </div>
    );
  }
  return <SharedAlbumReadyPage key={props.state.slug} {...props} state={props.state} />;
}
