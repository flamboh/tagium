import { useEffect, useState } from "react";
import {
  ImageNotFound01Icon,
  LibraryIcon,
  LinkSquare02Icon,
  MusicNote04Icon,
  PlusSignIcon,
  RotateLeft02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { loaderCircleIcon } from "@/components/icons/loaderCircle";
import { toast } from "sonner";
import { Num, Plural, t, T, useGT, useLocale, Var } from "gt-react";
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
import {
  manifestArtwork,
  manifestTracks,
  type Manifest,
  type ManifestTrack,
} from "@/features/share/shareManifest";
import { shareLinkForSlug } from "@/features/share/shareLink";

export type SharedContentPageState =
  | { status: "loading"; slug: string }
  | {
      status: "unavailable";
      slug: string;
      reason: "unavailable" | "newer-version";
    }
  | {
      status: "ready";
      slug: string;
      manifest: Manifest;
      expiresAt: string | null;
      analyticsId: string;
    };

type ReadySharedContentPageState = Extract<SharedContentPageState, { status: "ready" }>;

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
            <T>stop sharing</T>
          </Button>
        )}
      </div>
    </header>
  );
}

function SharedContentSkeleton({ onOpenTagium }: { onOpenTagium: () => void }) {
  const gt = useGT();

  return (
    <div className="min-h-svh bg-background">
      <Header onOpenTagium={onOpenTagium} />
      <main
        aria-busy="true"
        aria-label={gt("opening shared link")}
        className="mx-auto w-full max-w-3xl px-5 pb-10 pt-9 sm:px-8 sm:pt-12"
      >
        <div className="mb-5 h-4 w-56 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="flex items-start gap-6 max-sm:gap-4">
          <div className="size-40 shrink-0 animate-pulse rounded-lg bg-muted motion-reduce:animate-none max-sm:size-24" />
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
        <span className="sr-only">
          <T>opening shared album…</T>
        </span>
      </main>
    </div>
  );
}

function Artwork({ slug, title }: { slug: string; title: string }) {
  const gt = useGT();
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");

  return (
    <div
      aria-busy={status === "loading"}
      className="relative flex size-40 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-center text-xs text-muted-foreground ring-1 ring-border/60 max-sm:size-24"
    >
      {status === "failed" ? (
        <div className="flex flex-col items-center justify-center gap-2">
          <HugeiconsIcon
            icon={ImageNotFound01Icon}
            strokeWidth={2}
            className="size-6"
            aria-hidden="true"
          />
          <span className="max-sm:sr-only">
            <T>cover art unavailable</T>
          </span>
        </div>
      ) : (
        <>
          {status === "loading" && (
            <div role="status">
              <HugeiconsIcon
                icon={loaderCircleIcon}
                strokeWidth={2}
                className="size-6 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              <span className="sr-only">
                <T>loading cover art…</T>
              </span>
            </div>
          )}
          <img
            src={sharedArtworkUrl(slug)}
            alt={gt("{title} cover", { title })}
            className={`absolute inset-0 size-full object-cover transition-opacity duration-200 motion-reduce:transition-none ${
              status === "loaded" ? "opacity-100" : "opacity-0"
            }`}
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("failed")}
          />
        </>
      )}
    </div>
  );
}

function ContentHero({ manifest, slug }: { manifest: Manifest; slug: string }) {
  const gt = useGT();

  const content =
    manifest.kind === "album"
      ? {
          title: manifest.album.title || gt("untitled album"),
          artist: manifest.album.artist,
          sourceUrl: manifest.album.sourceUrl,
        }
      : {
          title: manifest.track.metadata.title || gt("untitled track"),
          artist: manifest.track.metadata.artist,
          sourceUrl: manifest.track.sourceUrl,
        };

  const sourceLabel = content.sourceUrl
    ? new URL(content.sourceUrl).hostname.replace(/^www\./, "")
    : null;

  return (
    <section className="flex items-start gap-6 max-sm:gap-4">
      {manifestArtwork(manifest) ? (
        <Artwork slug={slug} title={content.title} />
      ) : (
        <div className="flex size-40 shrink-0 items-center justify-center rounded-lg bg-muted max-sm:size-24">
          <HugeiconsIcon
            icon={MusicNote04Icon}
            strokeWidth={2}
            className="size-9 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">
            <T>no cover art</T>
          </span>
        </div>
      )}
      <div className="min-w-0 py-1">
        <h1 className="break-words text-3xl font-semibold tracking-tight [overflow-wrap:anywhere] max-sm:text-xl">
          {content.title}
        </h1>
        <p className="mt-2 text-lg text-muted-foreground max-sm:text-sm">
          {content.artist || gt("unknown artist")}
        </p>
        {content.sourceUrl && sourceLabel && (
          <a
            href={content.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:text-foreground hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={gt("from {source} (opens in a new tab)", { source: sourceLabel })}
          >
            <T>
              from <Var>{sourceLabel}</Var>
            </T>
            <HugeiconsIcon
              icon={LinkSquare02Icon}
              strokeWidth={2}
              className="size-3.5"
              aria-hidden="true"
            />
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
  const gt = useGT();
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
        <T>
          <Plural
            n={tracks.length}
            one={
              <>
                <Num>{tracks.length}</Num> track
              </>
            }
            other={
              <>
                <Num>{tracks.length}</Num> tracks
              </>
            }
          />
        </T>
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
                  {track.metadata.title || gt("untitled track")}
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

function AnotherTabToast({
  slug,
  kind,
  anotherTabOpen,
}: {
  slug: string;
  kind: Manifest["kind"];
  anotherTabOpen: boolean;
}) {
  useEffect(() => {
    if (!anotherTabOpen) return;
    const link = shareLinkForSlug(slug);

    const copyShareLink = async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast.success(t("share link copied"));
      } catch {
        toast.error(t("copy failed"), {
          description: t("copy this link and paste it in the other tab: {link}", { link }),
        });
      }
    };

    const timeout = globalThis.setTimeout(() => {
      toast(
        kind === "album"
          ? t(
              "tagium is already open in another tab. copy the link and add the album there instead.",
            )
          : t(
              "tagium is already open in another tab. copy the link and add the track there instead.",
            ),
        {
          duration: 12_000,
          action: {
            label: t("copy link"),
            onClick: () => void copyShareLink(),
          },
        },
      );
    }, 1_500);

    return () => globalThis.clearTimeout(timeout);
  }, [anotherTabOpen, kind, slug]);

  return null;
}

function RecipientContext({
  kind,
  trackCount,
  expiresAt,
}: {
  kind: Manifest["kind"];
  trackCount: number;
  expiresAt: string | null;
}) {
  const gt = useGT();
  const locale = useLocale();

  const summary =
    kind === "album"
      ? gt(
          "{count, plural, one {shared album · {count} track} other {shared album · {count} tracks}}",
          { count: trackCount },
        )
      : gt(
          "{count, plural, one {shared track · {count} track} other {shared track · {count} tracks}}",
          { count: trackCount },
        );

  return (
    <p className="mb-5 text-sm text-muted-foreground">
      {summary}
      {expiresAt === null
        ? null
        : gt(" · link expires {date}", {
            date: new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" })
              .format(new Date(expiresAt))
              .toLocaleLowerCase(locale),
          })}
    </p>
  );
}

function AddingExplanation({ kind }: { kind: Manifest["kind"] }) {
  const gt = useGT();

  return (
    <p className="mt-7 max-w-lg text-sm leading-6 text-muted-foreground">
      {kind === "album"
        ? gt("adding downloads each track from its original source with the shared tags.")
        : gt("adding downloads this track from its original source with the shared tags.")}
    </p>
  );
}

function StopSharingDialog({
  open,
  onOpenChange,
  stopping,
  stopError,
  kind,
  onStop,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stopping: boolean;
  stopError: string | null;
  kind: Manifest["kind"];
  onStop: () => void;
}) {
  const gt = useGT();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {kind === "album" ? gt("stop sharing this album?") : gt("stop sharing this track?")}
          </DialogTitle>
          <DialogDescription>
            {kind === "album"
              ? gt(
                  "the link will stop working immediately. anyone who already added the album keeps their copy.",
                )
              : gt(
                  "the link will stop working immediately. anyone who already added the track keeps their copy.",
                )}
          </DialogDescription>
          {stopError && (
            <p role="alert" className="text-sm text-destructive">
              {stopError}
            </p>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            <T>keep sharing</T>
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="w-32 min-w-[7rem] justify-center"
            disabled={stopping}
            onClick={onStop}
          >
            {stopping && (
              <HugeiconsIcon
                icon={loaderCircleIcon}
                strokeWidth={2}
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            <T>stop sharing</T>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionBar({
  alreadyAddedTargetId,
  adding,
  kind,
  primaryLabel,
  onAdd,
  onViewAdded,
}: {
  alreadyAddedTargetId: string | null;
  adding: boolean;
  kind: Manifest["kind"];
  primaryLabel: string;
  onAdd: (allowDuplicate?: boolean) => void;
  onViewAdded: () => void;
}) {
  const gt = useGT();

  return (
    <div className="mt-8 flex flex-wrap items-center gap-2">
      <div className="flex shrink-0 items-center gap-4 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
        <Button
          type="button"
          className="h-10 w-40 justify-center max-sm:w-full"
          disabled={adding}
          onClick={alreadyAddedTargetId ? onViewAdded : () => onAdd()}
        >
          {adding ? (
            <HugeiconsIcon
              icon={loaderCircleIcon}
              strokeWidth={2}
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : alreadyAddedTargetId ? (
            <HugeiconsIcon icon={LibraryIcon} strokeWidth={2} aria-hidden="true" />
          ) : (
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} aria-hidden="true" />
          )}
          {adding ? (kind === "album" ? gt("adding album…") : gt("adding track…")) : primaryLabel}
        </Button>
        {alreadyAddedTargetId && (
          <Button
            type="button"
            variant="link"
            className="h-10 px-0 max-sm:self-center"
            onClick={() => onAdd(true)}
            disabled={adding}
          >
            <T>add another copy</T>
          </Button>
        )}
      </div>
    </div>
  );
}

function SharedContentReadyPage({
  state,
  anotherTabOpen,
  alreadyAddedTargetId,
  adding,
  canStopSharing,
  onOpenTagium,
  onAdd,
  onViewAdded,
  onStopSharing,
}: {
  state: ReadySharedContentPageState;
  anotherTabOpen: boolean;
  alreadyAddedTargetId: string | null;
  adding: boolean;
  canStopSharing: boolean;
  onBack: () => void;
  onOpenTagium: () => void;
  onAdd: (allowDuplicate?: boolean) => void;
  onViewAdded: () => void;
  onStopSharing: () => Promise<void>;
}) {
  const gt = useGT();
  const [showStopConfirmation, setShowStopConfirmation] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  const { manifest, slug } = state;
  const tracks = manifestTracks(manifest);
  const primaryLabel = alreadyAddedTargetId ? gt("open in tagium") : gt("add to library");

  const stopSharing = async () => {
    setStopping(true);
    setStopFailed(false);

    try {
      await onStopSharing();
      setShowStopConfirmation(false);
    } catch {
      setStopFailed(true);
    } finally {
      setStopping(false);
    }
  };

  const setStopDialogOpen = (open: boolean) => {
    setShowStopConfirmation(open);

    if (!open) {
      setStopFailed(false);
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
        <RecipientContext
          kind={manifest.kind}
          trackCount={tracks.length}
          expiresAt={state.expiresAt}
        />
        <ContentHero manifest={manifest} slug={slug} />
        <AddingExplanation kind={manifest.kind} />
        <ActionBar
          alreadyAddedTargetId={alreadyAddedTargetId}
          adding={adding}
          kind={manifest.kind}
          primaryLabel={primaryLabel}
          onAdd={onAdd}
          onViewAdded={onViewAdded}
        />
        <AnotherTabToast slug={slug} kind={manifest.kind} anotherTabOpen={anotherTabOpen} />
        {manifest.kind === "album" && (
          <TrackList tracks={manifest.tracks} albumArtist={manifest.album.artist} />
        )}
      </main>
      <StopSharingDialog
        open={showStopConfirmation}
        onOpenChange={setStopDialogOpen}
        stopping={stopping}
        stopError={
          stopFailed
            ? gt("sharing could not be stopped. check your connection and try again.")
            : null
        }
        kind={manifest.kind}
        onStop={() => void stopSharing()}
      />
    </div>
  );
}

export default function SharedAlbumPage(props: {
  state: SharedContentPageState;
  workspaceTrackCount: number;
  anotherTabOpen: boolean;
  alreadyAddedTargetId: string | null;
  adding: boolean;
  canStopSharing: boolean;
  onBack: () => void;
  onOpenTagium: () => void;
  onAdd: (allowDuplicate?: boolean) => void;
  onViewAdded: () => void;
  onStopSharing: () => Promise<void>;
}) {
  if (props.state.status === "loading")
    return <SharedContentSkeleton onOpenTagium={props.onOpenTagium} />;

  if (props.state.status === "unavailable") {
    const newerVersion = props.state.reason === "newer-version";

    return (
      <div className="min-h-svh bg-background">
        <Header onOpenTagium={props.onOpenTagium} />
        <main className="mx-auto flex min-h-[calc(100svh-3.5rem)] w-full max-w-3xl items-center px-5 py-10 sm:px-8">
          <div className="py-16">
            <div className="mb-5 flex size-11 items-center justify-center rounded-lg bg-muted">
              {newerVersion ? (
                <HugeiconsIcon
                  icon={RotateLeft02Icon}
                  strokeWidth={2}
                  className="size-5"
                  aria-hidden="true"
                />
              ) : (
                <HugeiconsIcon
                  icon={MusicNote04Icon}
                  strokeWidth={2}
                  className="size-5"
                  aria-hidden="true"
                />
              )}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {newerVersion ? (
                <T>this link needs a newer version of tagium</T>
              ) : (
                <T>this share is no longer available</T>
              )}
            </h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              {newerVersion ? (
                <T>reload the page to update, then open the link again. nothing has been added.</T>
              ) : (
                <T>the link may have expired, or sharing was stopped.</T>
              )}
            </p>
          </div>
        </main>
      </div>
    );
  }

  return <SharedContentReadyPage key={props.state.slug} {...props} state={props.state} />;
}
