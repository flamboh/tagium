import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
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
import type { Manifest } from "@/features/share/shareManifest";

export type SharedAlbumPageState =
  | { status: "loading"; slug: string }
  | { status: "unavailable"; slug: string; reason: "unavailable" | "newer-version" }
  | { status: "ready"; slug: string; manifest: Manifest; expiresAt: string };

const providerName = (sourceUrl: string) => {
  const hostname = new URL(sourceUrl).hostname.toLowerCase();
  if (hostname === "youtu.be" || hostname.includes("youtube")) return "YouTube";
  if (hostname.includes("soundcloud")) return "SoundCloud";
  return hostname;
};

const summaryProviders = (manifest: Manifest) =>
  [...new Set(manifest.tracks.map((track) => providerName(track.sourceUrl)))].join(" + ");

const summaryBitrates = (manifest: Manifest) => {
  const rates = [...new Set(manifest.tracks.map((track) => track.audioBitrate))];
  return rates.length === 1 ? `${rates[0]} kbps` : "mixed bitrates";
};

const trackCountLabel = (count: number) => `${count} track${count === 1 ? "" : "s"}`;

function SharedAlbumSkeleton() {
  return (
    <main
      aria-busy="true"
      aria-label="opening shared album"
      className="mx-auto w-full max-w-3xl px-5 pb-32 pt-10 sm:px-8"
    >
      <div className="mb-12 flex items-center justify-between">
        <div className="h-6 w-20 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-5 w-28 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      </div>
      <div className="flex items-start gap-6 max-sm:flex-col">
        <div className="size-40 shrink-0 animate-pulse rounded-xl bg-muted motion-reduce:animate-none max-sm:size-24" />
        <div className="w-full space-y-3 py-2">
          <div className="h-8 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-5 w-2/5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      </div>
      <div className="mt-10 space-y-2 border-t pt-4">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex h-12 items-center gap-4 border-b">
            <div className="h-4 w-5 animate-pulse rounded bg-muted motion-reduce:animate-none" />
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
  if (failed) {
    return (
      <div className="flex size-40 shrink-0 flex-col items-center justify-center gap-2 rounded-xl bg-muted text-center text-xs text-muted-foreground max-sm:size-24">
        <ImageOff className="size-6" aria-hidden="true" />
        <span className="max-sm:sr-only">cover art unavailable</span>
      </div>
    );
  }
  return (
    <img
      src={sharedArtworkUrl(slug)}
      alt={`${title} cover`}
      className="size-40 shrink-0 rounded-xl object-cover ring-1 ring-border/60 max-sm:size-24"
      onError={() => setFailed(true)}
    />
  );
}

export default function SharedAlbumPage({
  state,
  workspaceTrackCount,
  anotherTabOpen,
  alreadyAddedAlbumId,
  adding,
  canStopSharing,
  onBack,
  onOpenTagium,
  onAdd,
  onViewAlbum,
  onStopSharing,
}: {
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
  const [showStopConfirmation, setShowStopConfirmation] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);

  if (state.status === "loading") return <SharedAlbumSkeleton />;

  if (state.status === "unavailable") {
    const newerVersion = state.reason === "newer-version";
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col px-6 py-10">
        <button
          type="button"
          onClick={onOpenTagium}
          className="w-fit text-lg font-bold tracking-tight"
        >
          tagium
        </button>
        <div className="my-auto py-16">
          <div className="mb-5 flex size-11 items-center justify-center rounded-lg bg-muted">
            {newerVersion ? <RotateCcw className="size-5" /> : <Music2 className="size-5" />}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {newerVersion
              ? "this link was made by a newer Tagium version"
              : "this shared album is no longer available"}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            {newerVersion
              ? "Reload the page after updating Tagium. The album has not been added."
              : "It may have expired or the creator may have stopped sharing it."}
          </p>
          <Button type="button" className="mt-6" onClick={onOpenTagium}>
            go to Tagium
          </Button>
        </div>
      </main>
    );
  }

  const { manifest, slug, expiresAt } = state;
  const trackCount = manifest.tracks.length;
  const hasWorkspace = workspaceTrackCount > 0;
  const primaryLabel = alreadyAddedAlbumId
    ? "view album"
    : `${hasWorkspace ? "add & download" : "download"} ${trackCountLabel(trackCount)}`;

  const stopSharing = async () => {
    setStopping(true);
    setStopError(null);
    try {
      await onStopSharing();
      setShowStopConfirmation(false);
    } catch {
      setStopError("Sharing could not be stopped. Check your connection and try again.");
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-5 sm:px-8">
          <button type="button" onClick={onOpenTagium} className="font-bold tracking-tight">
            tagium
          </button>
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <button
            type="button"
            onClick={onOpenTagium}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            go to Tagium <ExternalLink className="ml-1 inline size-3" aria-hidden="true" />
          </button>
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
                    onClick={() => setShowStopConfirmation(true)}
                  >
                    stop sharing
                  </button>
                </PopoverContent>
              </Popover>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft aria-hidden="true" /> back
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-3xl flex-col px-5 pb-36 pt-9 sm:px-8 sm:pt-12">
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
            <h1 className="text-3xl font-semibold tracking-tight text-balance max-sm:text-xl">
              {manifest.album.title || "untitled album"}
            </h1>
            <p className="mt-2 text-lg text-muted-foreground max-sm:text-sm">
              {manifest.album.artist || "unknown artist"}
            </p>
            <p className="mt-3 text-sm text-muted-foreground max-sm:mt-2">
              {[manifest.album.year, manifest.album.genre].filter(Boolean).join(" · ")}
            </p>
          </div>
        </section>

        <section className="mt-8 border-y py-5">
          <p className="font-medium">
            {trackCountLabel(trackCount)} · {summaryProviders(manifest)} ·{" "}
            {summaryBitrates(manifest)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Available until{" "}
            {new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(expiresAt))}.
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            This shared album includes tags and cover art chosen by its creator. Audio downloads
            from the original sources on this device.
          </p>
        </section>

        {(hasWorkspace || anotherTabOpen) && (
          <aside className="mt-6 space-y-2 rounded-lg bg-muted p-4 text-sm leading-6">
            {hasWorkspace && (
              <p>
                Your current {trackCountLabel(workspaceTrackCount)} will stay here. This album will
                be appended to your workspace.
              </p>
            )}
            {anotherTabOpen && (
              <p className="flex gap-2 text-muted-foreground">
                <AlertTriangle className="mt-1 size-4 shrink-0" aria-hidden="true" />
                <span>
                  Tagium is already open in another tab. Continuing here starts a separate
                  workspace.
                </span>
              </p>
            )}
          </aside>
        )}

        <section className="mt-8 min-h-0 flex-1" aria-labelledby="shared-track-list-title">
          <h2 id="shared-track-list-title" className="mb-3 text-sm font-semibold">
            tracks
          </h2>
          <ol className="max-h-[min(42svh,32rem)] overflow-y-auto border-y sm:max-h-[min(46svh,36rem)]">
            {manifest.tracks.map((track, index) => {
              const filenameDiffers = track.metadata.filename !== track.metadata.title;
              return (
                <li key={`${track.sourceUrl}-${index}`} className="border-b py-3">
                  <div className="flex items-start gap-3">
                    <span className="w-6 shrink-0 pt-0.5 text-right font-mono text-xs text-muted-foreground">
                      {track.metadata.trackNumber ?? index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {track.metadata.title || "untitled track"}
                      </p>
                      {filenameDiffers && (
                        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                          {track.metadata.filename}.mp3
                        </p>
                      )}
                      <details className="mt-2 text-xs text-muted-foreground">
                        <summary className="w-fit cursor-pointer select-none hover:text-foreground">
                          view tags
                        </summary>
                        <dl className="mt-2 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg bg-muted p-3">
                          <dt>artist</dt>
                          <dd>{track.metadata.artist || "—"}</dd>
                          <dt>album</dt>
                          <dd>{track.metadata.album || "—"}</dd>
                          <dt>genre</dt>
                          <dd>{track.metadata.genre || "—"}</dd>
                          <dt>year</dt>
                          <dd>{track.metadata.year ?? "—"}</dd>
                          <dt>source</dt>
                          <dd>{providerName(track.sourceUrl)}</dd>
                          <dt>bitrate</dt>
                          <dd>{track.audioBitrate} kbps</dd>
                        </dl>
                      </details>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 border-t bg-background/95 px-5 py-4 backdrop-blur-sm supports-[backdrop-filter]:bg-background/85 sm:px-8 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
          <div>
            {alreadyAddedAlbumId && (
              <p className="text-sm font-medium">this shared album is already in your library</p>
            )}
            <button
              type="button"
              onClick={onOpenTagium}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              open Tagium without adding this album
            </button>
          </div>
          <div className="flex shrink-0 gap-2 max-sm:flex-col-reverse">
            {alreadyAddedAlbumId && (
              <Button type="button" variant="outline" onClick={() => onAdd(true)} disabled={adding}>
                download another copy
              </Button>
            )}
            <Button
              type="button"
              size="lg"
              disabled={adding}
              onClick={alreadyAddedAlbumId ? onViewAlbum : () => onAdd()}
            >
              {adding ? (
                <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <Download aria-hidden="true" />
              )}
              {adding ? "adding album…" : primaryLabel}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showStopConfirmation} onOpenChange={setShowStopConfirmation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>stop sharing this album?</DialogTitle>
            <DialogDescription>The link and cover will stop working immediately.</DialogDescription>
            {stopError && (
              <p role="alert" className="text-sm text-destructive">
                {stopError}
              </p>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowStopConfirmation(false)}>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
