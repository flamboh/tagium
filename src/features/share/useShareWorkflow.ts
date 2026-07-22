import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { coverArtFileToPicture } from "@/features/editor/coverArtProcessing";
import type { TrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AudioImportSession } from "@/features/workspace/useAudioImportSession";
import {
  fetchSharedAlbum,
  fetchSharedAlbumArtwork,
  publishSharedAlbum,
  revokeSharedAlbum,
  SharedAlbumUnavailableError,
  SharedAlbumVersionError,
} from "@/features/share/shareClient";
import { projectAlbumManifest } from "@/features/share/shareManifest";
import {
  getRevocationReceipt,
  removeRevocationReceipt,
  storeRevocationReceipt,
} from "@/features/share/revocationReceipt";
import { detectAnotherTagiumTab, listenForTagiumPresence } from "@/features/share/sharePresence";
import { shareSlugFromPathname } from "@/features/share/shareLink";
import { shareEligibility } from "@/features/share/shareEligibility";
import type { ShareDialogState } from "@/features/share/ShareAlbumDialog";
import type { SharedAlbumPageState } from "@/features/share/SharedAlbumPage";

const pictureToFile = (
  picture: NonNullable<ReturnType<LibraryStore["getSnapshot"]>["albums"][number]["cover"]>,
) => {
  const first = picture[0];
  if (!first || (first.format !== "image/jpeg" && first.format !== "image/png")) return null;
  return new File(
    [new Uint8Array(first.data)],
    first.format === "image/png" ? "cover.png" : "cover.jpg",
    {
      type: first.format,
    },
  );
};

const safelyGetRevocationReceipt = (slug: string) => {
  try {
    return getRevocationReceipt(slug);
  } catch {
    return null;
  }
};

export const useShareWorkflow = ({
  library,
  editor,
  importing,
  enabled,
}: {
  library: LibraryStore;
  editor: Pick<TrackEditorSession, "commands">;
  importing: Pick<AudioImportSession, "commands">;
  enabled: boolean;
}) => {
  const initialSlug = shareSlugFromPathname(location.pathname);
  const [page, setPage] = useState<SharedAlbumPageState | null>(() =>
    enabled && initialSlug
      ? { status: "loading", slug: initialSlug }
      : location.pathname.startsWith("/share/")
        ? { status: "unavailable", slug: "", reason: "unavailable" }
        : null,
  );
  const [dialog, setDialog] = useState<ShareDialogState>({ status: "closed" });
  const [creatorAlbumId, setCreatorAlbumId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [anotherTabOpen, setAnotherTabOpen] = useState(false);
  const artworkFileRef = useRef<File | null>(null);
  const loadingSlugRef = useRef<string | null>(null);

  const loadSlug = useCallback(async (slug: string) => {
    loadingSlugRef.current = slug;
    setPage({ status: "loading", slug });
    try {
      const fetched = await fetchSharedAlbum(slug);
      const artwork = fetched.manifest.album.artwork ? await fetchSharedAlbumArtwork(slug) : null;
      if (loadingSlugRef.current !== slug) return fetched;
      artworkFileRef.current = artwork;
      setPage({ status: "ready", slug, ...fetched });
      void detectAnotherTagiumTab().then(setAnotherTabOpen);
      return fetched;
    } catch (error) {
      if (loadingSlugRef.current !== slug) throw error;
      artworkFileRef.current = null;
      setPage({
        status: "unavailable",
        slug,
        reason: error instanceof SharedAlbumVersionError ? "newer-version" : "unavailable",
      });
      throw error;
    }
  }, []);

  useEffect(() => listenForTagiumPresence(), []);

  useEffect(() => {
    if (!enabled && location.pathname.startsWith("/share/")) history.replaceState({}, "", "/");
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !initialSlug) return;
    void loadSlug(initialSlug).catch(() => undefined);
  }, [enabled, initialSlug, loadSlug]);

  useEffect(() => {
    const handlePopState = () => {
      const slug = enabled ? shareSlugFromPathname(location.pathname) : null;
      if (!slug) {
        loadingSlugRef.current = null;
        setPage(null);
        return;
      }
      void loadSlug(slug).catch(() => undefined);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [enabled, loadSlug]);

  const openFromInput = useCallback(
    async (slug: string) => {
      if (!enabled) throw new SharedAlbumUnavailableError();
      history.pushState({ shareSlug: slug }, "", `/share/${slug}`);
      try {
        await loadSlug(slug);
      } catch (error) {
        if (error instanceof SharedAlbumVersionError) throw error;
        throw new SharedAlbumUnavailableError();
      }
    },
    [enabled, loadSlug],
  );

  const closePage = useCallback((replace = false) => {
    loadingSlugRef.current = null;
    artworkFileRef.current = null;
    setPage(null);
    if (replace || !history.state?.shareSlug) history.replaceState({}, "", "/");
    else if (location.pathname.startsWith("/share/")) history.back();
  }, []);

  const openCreator = useCallback(
    (albumId: string) => {
      const snapshot = library.getSnapshot();
      const album = snapshot.albums.find((entry) => entry.id === albumId);
      if (!album) return;
      const files = album.trackIds.map((trackId) =>
        snapshot.files.find((file) => file.id === trackId),
      );
      const ineligibleReason = shareEligibility(album, files);
      if (ineligibleReason) {
        toast.error("this album cannot be shared", {
          description: ineligibleReason,
        });
        return;
      }
      setCreatorAlbumId(albumId);
      setDialog({
        status: "confirm",
        albumTitle: album.title,
        trackCount: album.trackIds.length,
        hasCover: Boolean(album.cover?.length),
      });
    },
    [library],
  );

  const publish = useCallback(async () => {
    if (!creatorAlbumId || dialog.status === "closed" || dialog.status === "published") return;
    const currentDialog = dialog;
    setDialog({ ...currentDialog, status: "publishing" });
    try {
      editor.commands.flush();
      const snapshot = library.getSnapshot();
      const album = snapshot.albums.find((entry) => entry.id === creatorAlbumId);
      if (!album) throw new Error("the album is no longer in your library");
      const files = album.trackIds.map((trackId) => {
        const file = snapshot.files.find((entry) => entry.id === trackId);
        if (!file) throw new Error("the album has a missing track");
        return file;
      });
      const cover = album.cover ? pictureToFile(album.cover) : null;
      const firstPicture = album.cover?.[0];
      const manifest = projectAlbumManifest(
        album,
        files,
        cover && firstPicture
          ? {
              kind: "stored",
              format: cover.type as "image/jpeg" | "image/png",
              type: firstPicture.type,
              description: firstPicture.description,
            }
          : undefined,
      );
      const receipt = await publishSharedAlbum(manifest, cover);
      try {
        storeRevocationReceipt({
          slug: receipt.slug,
          expiresAt: receipt.expiresAt,
          token: receipt.revocationToken,
        });
      } catch {
        await revokeSharedAlbum(receipt.slug, receipt.revocationToken);
        throw new Error("your browser did not allow Tagium to save the sharing permission");
      }
      setDialog({ status: "published", albumTitle: album.title, receipt });
    } catch (error) {
      setDialog({
        status: "error",
        albumTitle: currentDialog.albumTitle,
        trackCount: currentDialog.trackCount,
        hasCover: currentDialog.hasCover,
        message: error instanceof Error ? error.message : "the share link could not be created",
      });
    }
  }, [creatorAlbumId, dialog, editor.commands, library]);

  const stopDialogShare = useCallback(async () => {
    if (dialog.status !== "published") return;
    const receipt = dialog.receipt;
    await revokeSharedAlbum(receipt.slug, receipt.revocationToken);
    removeRevocationReceipt(receipt.slug);
    setDialog({ status: "closed" });
    toast.success("sharing stopped", { description: "The link and cover no longer work." });
  }, [dialog]);

  const stopPageShare = useCallback(async () => {
    if (page?.status !== "ready") return;
    const receipt = safelyGetRevocationReceipt(page.slug);
    if (!receipt) return;
    await revokeSharedAlbum(page.slug, receipt.token);
    removeRevocationReceipt(page.slug);
    setPage({ status: "unavailable", slug: page.slug, reason: "unavailable" });
    toast.success("sharing stopped", { description: "The link and cover no longer work." });
  }, [page]);

  const addSharedAlbum = useCallback(
    async (allowDuplicate = false) => {
      if (page?.status !== "ready" || adding) return;
      const existing = library
        .getSnapshot()
        .albums.find((album) => album.sourceManifestSlug === page.slug);
      if (existing && !allowDuplicate) return;
      setAdding(true);
      try {
        const fresh = await fetchSharedAlbum(page.slug);
        const convertedPicture = artworkFileRef.current
          ? await coverArtFileToPicture(artworkFileRef.current, "shared album cover")
          : undefined;
        const artwork = page.manifest.album.artwork;
        const picture = convertedPicture?.map((entry, index) =>
          index === 0 && artwork
            ? {
                ...entry,
                format: artwork.format,
                type: artwork.type,
                description: artwork.description,
              }
            : entry,
        );
        await importing.commands.importSharedAlbum(fresh.manifest, page.slug, picture);
        history.replaceState({}, "", "/");
        setPage(null);
        toast.success("album added · downloading 3 at a time");
      } catch (error) {
        if (error instanceof SharedAlbumUnavailableError) {
          setPage({ status: "unavailable", slug: page.slug, reason: "unavailable" });
        } else {
          toast.error("album could not be added", {
            description: "Your current workspace is unchanged. Try again.",
          });
        }
      } finally {
        setAdding(false);
      }
    },
    [adding, importing.commands, library, page],
  );

  const alreadyAddedAlbumId =
    page?.status === "ready"
      ? (library.state.albums.find((album) => album.sourceManifestSlug === page.slug)?.id ?? null)
      : null;

  const viewAlreadyAdded = useCallback(() => {
    if (!alreadyAddedAlbumId) return;
    const album = library.getSnapshot().albums.find((entry) => entry.id === alreadyAddedAlbumId);
    library.dispatch({
      type: "album-selected",
      albumId: alreadyAddedAlbumId,
      mode: "replace",
    });
    history.replaceState({}, "", "/");
    setPage(null);
    if (!album?.trackIds.length) return;
  }, [alreadyAddedAlbumId, library]);

  const canStopSharing = page?.status === "ready" && Boolean(safelyGetRevocationReceipt(page.slug));

  return {
    page,
    dialog,
    adding,
    anotherTabOpen,
    alreadyAddedAlbumId,
    canStopSharing,
    openFromInput,
    openCreator,
    publish: () => void publish(),
    closeDialog: () => setDialog({ status: "closed" }),
    stopDialogShare,
    stopPageShare,
    addSharedAlbum,
    viewAlreadyAdded,
    back: () => closePage(false),
    openTagium: () => closePage(true),
  };
};
