import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  ImageOff,
  Loader2,
  MoreHorizontal,
  Music2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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

function SharedAlbumSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="opening shared album"
      className="mx-auto w-full max-w-3xl px-5 pb-10 pt-10 sm:px-8"
    >
      <div className="mb-8 flex items-center">
        <div className="h-6 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>
      <div className="flex items-start gap-6 max-sm:flex-col max-sm:gap-4">
        <div className="size-40 shrink-0 animate-pulse rounded-xl bg-muted motion-reduce:animate-none max-sm:size-24" />
        <div className="w-full space-y-3 py-1">
          <div className="h-8 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-5 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      </div>
      <div className="mt-8 flex gap-2">
        <div className="h-10 w-36 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      </div>
      <div className="mt-8 space-y-3">
        {skeletonRows.map((row) => (
          <div key={row} className="flex h-5 items-center">
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
        ))}
      </div>
      <span className="sr-only">opening shared album…</span>
    </main>
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
  const titleNode = manifest.album.sourceUrl ? (
    <a
      href={manifest.album.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`${title} (opens source in a new tab)`}
    >
      {title}
      <ExternalLink className="ml-2 inline size-4 align-[0.1em]" aria-hidden="true" />
    </a>
  ) : (
    title
  );
  return (
    <section className="flex items-start gap-6 max-sm:flex-col max-sm:gap-4">
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
          {titleNode}
        </h1>
        <p className="mt-2 text-lg text-muted-foreground max-sm:text-sm">
          {manifest.album.artist || "unknown artist"}
        </p>
      </div>
    </section>
  );
}

function TrackList({ tracks }: { tracks: readonly ManifestTrack[] }) {
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
        tracks
      </h2>
      <ol className="list-decimal space-y-2 pl-6 marker:text-muted-foreground">
        {rows.map(({ track, key }) => {
          return (
            <li key={key} className="break-words pl-1 text-sm font-medium [overflow-wrap:anywhere]">
              {track.metadata.title || "untitled track"}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function WorkspaceNotice({
  slug,
  workspaceTrackCount,
  anotherTabOpen,
}: {
  slug: string;
  workspaceTrackCount: number;
  anotherTabOpen: boolean;
}) {
  const [copyFeedback, setCopyFeedback] = useState<"copied" | "failed" | null>(null);
  const shareLinkRef = useRef<HTMLInputElement>(null);
  if (workspaceTrackCount === 0 && !anotherTabOpen) return null;
  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLinkForSlug(slug));
      setCopyFeedback("copied");
    } catch {
      shareLinkRef.current?.select();
      setCopyFeedback("failed");
    }
  };
  return (
    <aside className="mt-6 space-y-2 text-sm leading-6">
      {workspaceTrackCount > 0 && (
        <p className="text-muted-foreground">your current tracks will stay here.</p>
      )}
      {anotherTabOpen && (
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle
              className="mt-1 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="text-muted-foreground">
              tagium is open in another tab, copy the link and download in the open instance.
            </span>
          </div>
          <div className="flex justify-start">
            <Button
              type="button"
              size="sm"
              className="w-32 min-w-[7.5rem] justify-center"
              onClick={() => void copyShareLink()}
            >
              {copyFeedback === "copied" ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
              {copyFeedback === "copied" ? "copied" : "copy link"}
            </Button>
          </div>
          <input
            ref={shareLinkRef}
            readOnly
            aria-label="share link"
            value={shareLinkForSlug(slug)}
            className={
              copyFeedback === "failed"
                ? "w-full min-w-0 rounded-md border bg-background px-2 py-1 font-mono text-xs"
                : "sr-only"
            }
          />
          <span role="status" className="sr-only" aria-live="polite">
            {copyFeedback === "copied"
              ? "share link copied."
              : copyFeedback === "failed"
                ? "copy failed. the share link is selected; copy it and paste it in the other tab."
                : ""}
          </span>
          {copyFeedback === "failed" && (
            <p className="w-full text-xs text-destructive">
              copy failed. copy the selected link and paste it in the other tab.
            </p>
          )}
        </div>
      )}
    </aside>
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
          <DialogDescription>the link will stop working immediately.</DialogDescription>
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

function Header({
  canStopSharing,
  onOpenTagium,
  onStop,
}: {
  canStopSharing: boolean;
  onOpenTagium: () => void;
  onStop: () => void;
}) {
  return (
    <header>
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-5 sm:px-8">
        <Button type="button" variant="ghost" size="sm" onClick={onOpenTagium}>
          <ArrowLeft aria-hidden="true" /> back to tagium
        </Button>
        <div className="ml-auto flex items-center gap-1">
          {canStopSharing && (
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="shared album menu">
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44 p-1">
                <button
                  type="button"
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                  onClick={onStop}
                >
                  stop sharing
                </button>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </header>
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
      <div className="flex shrink-0 gap-2 max-sm:w-full max-sm:flex-col-reverse">
        {alreadyAddedAlbumId && (
          <Button type="button" variant="outline" onClick={() => onAdd(true)} disabled={adding}>
            download another copy
          </Button>
        )}
        <Button
          type="button"
          size="lg"
          className="w-40 justify-center max-sm:w-full"
          disabled={adding}
          onClick={alreadyAddedAlbumId ? onViewAlbum : () => onAdd()}
        >
          {adding ? (
            <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Download aria-hidden="true" />
          )}
          {adding ? "downloading album…" : primaryLabel}
        </Button>
      </div>
    </div>
  );
}

function SharedAlbumReadyPage({
  state,
  workspaceTrackCount,
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
  const [showStopConfirmation, setShowStopConfirmation] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const { manifest, slug } = state;
  const primaryLabel = alreadyAddedAlbumId ? "open album" : "download album";
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
        <AlbumHero manifest={manifest} slug={slug} />
        <ActionBar
          alreadyAddedAlbumId={alreadyAddedAlbumId}
          adding={adding}
          primaryLabel={primaryLabel}
          onAdd={onAdd}
          onViewAlbum={onViewAlbum}
        />
        <WorkspaceNotice
          slug={slug}
          workspaceTrackCount={workspaceTrackCount}
          anotherTabOpen={anotherTabOpen}
        />
        <TrackList tracks={manifest.tracks} />
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
  if (props.state.status === "loading") return <SharedAlbumSkeleton />;
  if (props.state.status === "unavailable") {
    const newerVersion = props.state.reason === "newer-version";
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col px-6 py-10">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={props.onOpenTagium}
        >
          <ArrowLeft aria-hidden="true" /> back to tagium
        </Button>
        <div className="my-auto py-16">
          <div className="mb-5 flex size-11 items-center justify-center rounded-lg bg-muted">
            {newerVersion ? <RotateCcw className="size-5" /> : <Music2 className="size-5" />}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {newerVersion
              ? "this link was made by a newer tagium version"
              : "this shared album is no longer available"}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            {newerVersion
              ? "reload the page after updating tagium. the album has not been added."
              : "it may have expired or the creator may have stopped sharing it."}
          </p>
        </div>
      </main>
    );
  }
  return <SharedAlbumReadyPage key={props.state.slug} {...props} state={props.state} />;
}
