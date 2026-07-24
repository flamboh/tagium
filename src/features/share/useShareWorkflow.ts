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
  updateSharedAlbum,
} from "@/features/share/shareClient";
import {
  getRevocationReceipt,
  removeRevocationReceipt,
  storeRevocationReceipt,
} from "@/features/share/revocationReceipt";
import { detectAnotherTagiumTab, listenForTagiumPresence } from "@/features/share/sharePresence";
import { shareSlugFromPathname } from "@/features/share/shareLink";
import { shareEligibility } from "@/features/share/shareEligibility";
import { sharePublicationErrorMessage } from "@/features/share/sharePublicationError";
import type { ShareDialogState } from "@/features/share/ShareAlbumDialog";
import { buildShareAlbumPreview } from "@/features/share/sharePreview";
import {
  isActiveSharePublication,
  projectShareSnapshot,
  shareAlbumActionState,
  type ShareAlbumActionState,
} from "@/features/share/sharePublication";
import type { SharedAlbumPageState } from "@/features/share/SharedAlbumPage";

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
  const [albumFingerprints, setAlbumFingerprints] = useState<Record<string, string | undefined>>(
    {},
  );
  const [adding, setAdding] = useState(false);
  const [anotherTabOpen, setAnotherTabOpen] = useState(false);
  const [, setExpiryTick] = useState(0);
  const artworkFileRef = useRef<File | null>(null);
  const loadingSlugRef = useRef<string | null>(null);
  const importingSlugRef = useRef<string | null>(null);
  const publicationReceiptsRef = useRef(
    new Map<string, { slug: string; expiresAt: string; token: string }>(),
  );
  const publicationActionInFlightRef = useRef(false);
  const getPublicationCapability = useCallback(
    (slug: string) => publicationReceiptsRef.current.get(slug) ?? safelyGetRevocationReceipt(slug),
    [],
  );

  useEffect(() => {
    const expiries: number[] = [];
    const now = Date.now();
    for (const album of library.state.albums) {
      if (album.sharePublication?.status !== "active") continue;
      const expiry = Date.parse(album.sharePublication.expiresAt);
      if (Number.isFinite(expiry) && expiry > now) expiries.push(expiry);
    }
    if (!expiries.length) return;
    const timer = globalThis.setTimeout(
      () => setExpiryTick((tick) => tick + 1),
      Math.min(2_147_483_647, Math.max(0, Math.min(...expiries) - now + 1)),
    );
    return () => globalThis.clearTimeout(timer);
  }, [library.state.albums]);

  useEffect(() => {
    let canceled = false;
    const publishedAlbums = library.state.albums.filter(
      (album) => album.sharePublication?.status === "active",
    );
    if (!publishedAlbums.length) {
      setAlbumFingerprints({});
      return () => {
        canceled = true;
      };
    }
    setAlbumFingerprints((current) =>
      Object.fromEntries(publishedAlbums.map((album) => [album.id, current[album.id]])),
    );
    void Promise.all(
      publishedAlbums.map(async (album) => {
        const files = (album.trackIds ?? []).map((trackId) =>
          library.state.files?.find((file) => file.id === trackId),
        );
        if (files.some((file) => !file)) return [album.id, undefined] as const;
        try {
          const snapshot = await projectShareSnapshot(
            album,
            files as NonNullable<(typeof files)[number]>[],
          );
          return [album.id, snapshot.fingerprint] as const;
        } catch {
          return [album.id, undefined] as const;
        }
      }),
    ).then((entries) => {
      if (!canceled) setAlbumFingerprints(Object.fromEntries(entries));
    });
    return () => {
      canceled = true;
    };
  }, [library.state.albums, library.state.files]);

  const currentLibrary = library.getSnapshot();
  const shareActions = Object.fromEntries(
    currentLibrary.albums.map((album): [string, ShareAlbumActionState] => {
      const files = (album.trackIds ?? []).map((trackId) =>
        currentLibrary.files?.find((file) => file.id === trackId),
      );
      const eligibilityReason = shareEligibility(album, files);
      if (eligibilityReason) {
        return [album.id, { enabled: false, label: "share album", reason: eligibilityReason }];
      }
      const publication = album.sharePublication;
      return [
        album.id,
        shareAlbumActionState(
          album,
          albumFingerprints[album.id],
          Boolean(publication && getPublicationCapability(publication.slug)),
        ),
      ];
    }),
  );

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

  const importFromInput = useCallback(
    async (slug: string) => {
      if (!enabled) throw new SharedAlbumUnavailableError();
      if (importingSlugRef.current) return;

      const existing = library
        .getSnapshot()
        .albums.find((album) => album.sourceManifestSlug === slug);
      if (existing) {
        // Mirror normal workspace selection: commit any buffered metadata before changing album.
        editor.commands.flush();
        library.dispatch({
          type: "album-selected",
          albumId: existing.id,
          mode: "replace",
        });
        return;
      }

      importingSlugRef.current = slug;
      try {
        const fresh = await fetchSharedAlbum(slug);
        const artworkFile = fresh.manifest.album.artwork
          ? await fetchSharedAlbumArtwork(slug)
          : null;
        const convertedPicture = artworkFile
          ? await coverArtFileToPicture(artworkFile, "shared album cover")
          : undefined;
        const artwork = fresh.manifest.album.artwork;
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
        await importing.commands.importSharedAlbum(fresh.manifest, slug, picture);
        toast.success("shared album added · download started");
      } catch (error) {
        if (error instanceof SharedAlbumVersionError) throw error;
        throw new SharedAlbumUnavailableError();
      } finally {
        importingSlugRef.current = null;
      }
    },
    [editor.commands, enabled, importing.commands, library],
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
      const publication = album.sharePublication;
      const action = shareAlbumActionState(
        album,
        albumFingerprints[album.id],
        Boolean(publication && getPublicationCapability(publication.slug)),
      );
      if (!action?.enabled) {
        toast.error(action?.reason ?? "this album cannot be shared");
        return;
      }
      setCreatorAlbumId(albumId);
      const preview = buildShareAlbumPreview(album, files);
      if (publication && action.label === "view share link") {
        const capability = getPublicationCapability(publication.slug);
        if (!capability) {
          toast.error("share link permission unavailable", {
            description: "try the browser that created this link",
          });
          return;
        }
        setDialog({
          status: "published",
          preview,
          receipt: {
            slug: publication.slug,
            url: publication.url,
            expiresAt: publication.expiresAt,
            revocationToken: capability.token,
          },
        });
        return;
      }
      setDialog({
        status: "confirm",
        preview,
        intent: action.label === "update shared album" ? "update" : "create",
      });
    },
    [albumFingerprints, getPublicationCapability, library],
  );

  const publish = useCallback(async () => {
    if (
      publicationActionInFlightRef.current ||
      !creatorAlbumId ||
      dialog.status === "closed" ||
      dialog.status === "published"
    )
      return;
    publicationActionInFlightRef.current = true;
    const currentDialog = dialog;
    let attemptedIntent = currentDialog.intent;
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
      const existingPublication = album.sharePublication;
      const latestAction = shareAlbumActionState(
        album,
        albumFingerprints[album.id],
        Boolean(existingPublication && getPublicationCapability(existingPublication.slug)),
      );
      const updating = latestAction.label === "update shared album";
      const creating = latestAction.label === "share album";
      if (!latestAction.enabled || (!updating && !creating)) {
        throw new Error(latestAction.reason);
      }
      attemptedIntent = updating ? "update" : "create";
      const shareSnapshot = await projectShareSnapshot(album, files);
      let receipt;
      if (updating) {
        if (!existingPublication || !isActiveSharePublication(existingPublication)) {
          throw new Error("the shared album can no longer be updated");
        }
        const capability = getPublicationCapability(existingPublication.slug);
        if (!capability) throw new Error("this browser cannot update the shared album");
        await updateSharedAlbum(
          existingPublication.slug,
          capability.token,
          shareSnapshot.manifest,
          shareSnapshot.cover,
        );
        receipt = {
          slug: existingPublication.slug,
          url: existingPublication.url,
          expiresAt: existingPublication.expiresAt,
          revocationToken: capability.token,
        };
      } else {
        receipt = await publishSharedAlbum(shareSnapshot.manifest, shareSnapshot.cover);
        const capability = {
          slug: receipt.slug,
          expiresAt: receipt.expiresAt,
          token: receipt.revocationToken,
        };
        publicationReceiptsRef.current.set(receipt.slug, capability);
        library.dispatch({
          type: "album-share-publication-set",
          albumId: album.id,
          publication: {
            slug: receipt.slug,
            url: receipt.url,
            expiresAt: receipt.expiresAt,
            publishedFingerprint: shareSnapshot.fingerprint,
            status: "active",
          },
        });
        try {
          storeRevocationReceipt(capability);
        } catch {
          try {
            await revokeSharedAlbum(receipt.slug, receipt.revocationToken);
            publicationReceiptsRef.current.delete(receipt.slug);
            library.dispatch({
              type: "album-share-publication-set",
              albumId: album.id,
              publication: {
                slug: receipt.slug,
                url: receipt.url,
                expiresAt: receipt.expiresAt,
                publishedFingerprint: shareSnapshot.fingerprint,
                status: "stopped",
              },
            });
          } catch {
            throw new Error("your browser did not allow tagium to save the sharing permission");
          }
          throw new Error("your browser did not allow tagium to save the sharing permission");
        }
      }
      library.dispatch({
        type: "album-share-publication-set",
        albumId: album.id,
        publication: {
          slug: receipt.slug,
          url: receipt.url,
          expiresAt: receipt.expiresAt,
          publishedFingerprint: shareSnapshot.fingerprint,
          status: "active",
        },
      });
      setDialog({
        status: "published",
        preview: currentDialog.preview,
        receipt,
      });
    } catch (error) {
      setDialog({
        status: "error",
        preview: currentDialog.preview,
        intent: attemptedIntent,
        message:
          attemptedIntent === "update"
            ? "the shared album could not be updated. the link still has the previous version."
            : `${sharePublicationErrorMessage(error).replace(/[.!?]+$/, "")}. no link was created.`,
      });
    } finally {
      publicationActionInFlightRef.current = false;
    }
  }, [
    albumFingerprints,
    creatorAlbumId,
    dialog,
    editor.commands,
    getPublicationCapability,
    library,
  ]);

  const stopDialogShare = useCallback(async () => {
    if (dialog.status !== "published") return;
    const receipt = dialog.receipt;
    await revokeSharedAlbum(receipt.slug, receipt.revocationToken);
    publicationReceiptsRef.current.delete(receipt.slug);
    removeRevocationReceipt(receipt.slug);
    if (creatorAlbumId) {
      const album = library.getSnapshot().albums.find((entry) => entry.id === creatorAlbumId);
      if (album?.sharePublication?.slug === receipt.slug) {
        library.dispatch({
          type: "album-share-publication-set",
          albumId: creatorAlbumId,
          publication: { ...album.sharePublication, status: "stopped" },
        });
      }
    }
    setDialog({ status: "closed" });
    toast.success("sharing stopped", {
      description: "the link no longer works.",
    });
  }, [creatorAlbumId, dialog, library]);

  const stopPageShare = useCallback(async () => {
    if (page?.status !== "ready") return;
    const receipt = getPublicationCapability(page.slug);
    if (!receipt) return;
    await revokeSharedAlbum(page.slug, receipt.token);
    publicationReceiptsRef.current.delete(page.slug);
    removeRevocationReceipt(page.slug);
    const creatorAlbum = library
      .getSnapshot()
      .albums.find((album) => album.sharePublication?.slug === page.slug);
    if (creatorAlbum?.sharePublication) {
      library.dispatch({
        type: "album-share-publication-set",
        albumId: creatorAlbum.id,
        publication: { ...creatorAlbum.sharePublication, status: "stopped" },
      });
    }
    setPage({ status: "unavailable", slug: page.slug, reason: "unavailable" });
    toast.success("sharing stopped", {
      description: "the link no longer works.",
    });
  }, [getPublicationCapability, library, page]);

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
        toast.success("shared album added · download started");
      } catch (error) {
        if (error instanceof SharedAlbumUnavailableError) {
          setPage({
            status: "unavailable",
            slug: page.slug,
            reason: "unavailable",
          });
        } else {
          toast.error("album could not be added", {
            description: "your current workspace is unchanged. try again.",
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

  const canStopSharing = page?.status === "ready" && Boolean(getPublicationCapability(page.slug));

  return {
    page,
    dialog,
    adding,
    anotherTabOpen,
    alreadyAddedAlbumId,
    canStopSharing,
    shareActions,
    importFromInput,
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
