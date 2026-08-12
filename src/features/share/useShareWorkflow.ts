import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { analytics } from "@/analytics";
import { coverArtFileToPicture } from "@/features/editor/coverArtProcessing";
import type { TrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { AlbumGroup, SharePublication } from "@/features/library/types";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { AudioImportSession } from "@/features/workspace/useAudioImportSession";
import {
  fetchSharedArtwork,
  fetchSharedContent,
  publishShare,
  revokeShare,
  SharedContentUnavailableError,
  SharedContentVersionError,
  updateShare,
} from "@/features/share/shareClient";
import {
  getRevocationReceipt,
  removeRevocationReceipt,
  storeRevocationReceipt,
} from "@/features/share/revocationReceipt";
import { detectAnotherTagiumTab, listenForTagiumPresence } from "@/features/share/sharePresence";
import { shareLinkForSlug, shareSlugFromPathname } from "@/features/share/shareLink";
import { shareEligibility, shareTrackEligibility } from "@/features/share/shareEligibility";
import { manifestArtwork, manifestTrackCount, type Manifest } from "@/features/share/shareManifest";
import { sharePublicationErrorMessage } from "@/features/share/sharePublicationError";
import type { ShareDialogState } from "@/features/share/ShareAlbumDialog";
import { buildShareAlbumPreview, buildShareTrackPreview } from "@/features/share/sharePreview";
import {
  isActiveSharePublication,
  projectAlbumShareSnapshot,
  projectTrackShareSnapshot,
  shareAlbumActionState,
  shareTrackActionState,
  type ShareActionState,
  type ShareSnapshot,
} from "@/features/share/sharePublication";
import type { SharedContentPageState } from "@/features/share/SharedAlbumPage";

type ShareTarget = { kind: "album"; id: string } | { kind: "track"; id: string };

const SHAREABLE_TRACK_METADATA_FIELDS = [
  "filename",
  "title",
  "artist",
  "album",
  "genre",
  "year",
  "trackNumber",
  "picture",
] as const;
const SHARE_FINGERPRINT_DELAY_MS = 150;

const safelyGetRevocationReceipt = (slug: string) => {
  try {
    return getRevocationReceipt(slug);
  } catch {
    return null;
  }
};

const sharedContentAddedDescription = (manifest: Manifest) => {
  const count = manifestTrackCount(manifest);
  return `downloading ${count} ${count === 1 ? "track" : "tracks"} — watch progress in the sidebar.`;
};

const albumForTrack = (albums: readonly AlbumGroup[], trackId: string) =>
  albums.find((album) => album.trackIds.includes(trackId));

const selectTrack = (library: LibraryStore, fileId: string) => {
  const snapshot = library.getSnapshot();
  library.dispatch({
    type: "track-selected",
    albumId: albumForTrack(snapshot.albums, fileId)?.id ?? null,
    fileId,
    mode: "replace",
  });
};

const publicationForTarget = (
  snapshot: ReturnType<LibraryStore["getSnapshot"]>,
  target: ShareTarget,
) =>
  target.kind === "album"
    ? snapshot.albums.find((album) => album.id === target.id)?.sharePublication
    : snapshot.files.find((file) => file.id === target.id)?.sharePublication;

export const useShareWorkflow = ({
  library,
  editor,
  importing,
  enabled,
}: {
  library: LibraryStore;
  editor: Pick<TrackEditorSession, "commands"> & {
    form: Pick<TrackEditorSession["form"], "subscribe">;
  };
  importing: Pick<AudioImportSession, "commands">;
  enabled: boolean;
}) => {
  const initialSlug = shareSlugFromPathname(location.pathname);
  const [page, setPage] = useState<SharedContentPageState | null>(() =>
    enabled && initialSlug
      ? { status: "loading", slug: initialSlug }
      : location.pathname.startsWith("/share/")
        ? { status: "unavailable", slug: "", reason: "unavailable" }
        : null,
  );
  const [dialog, setDialog] = useState<ShareDialogState>({ status: "closed" });
  const [creatorTarget, setCreatorTarget] = useState<ShareTarget | null>(null);
  const [albumFingerprints, setAlbumFingerprints] = useState<Record<string, string | undefined>>(
    {},
  );
  const [trackFingerprints, setTrackFingerprints] = useState<Record<string, string | undefined>>(
    {},
  );
  const [adding, setAdding] = useState(false);
  const [anotherTabOpen, setAnotherTabOpen] = useState(false);
  const [, setExpiryTick] = useState(0);
  const loadingSlugRef = useRef<string | null>(null);
  const pageLoadIdRef = useRef(0);
  const importingSlugRef = useRef<string | null>(null);
  const publicationReceiptsRef = useRef(
    new Map<string, { slug: string; expiresAt: string; token: string }>(),
  );
  const publicationActionInFlightRef = useRef(false);
  const projectFilesRef = useRef(editor.commands.projectFiles);
  const [projectedFiles, setProjectedFiles] = useState(() => library.state.files);
  const getPublicationCapability = useCallback(
    (slug: string) => publicationReceiptsRef.current.get(slug) ?? safelyGetRevocationReceipt(slug),
    [],
  );

  // Keep form projection work outside render while always calling the latest editor command.
  useEffect(() => {
    projectFilesRef.current = editor.commands.projectFiles;
  });

  useEffect(() => {
    setProjectedFiles(projectFilesRef.current());
  }, [library.state.files]);

  const subscribeToEditorForm = editor.form.subscribe;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const unsubscribe = subscribeToEditorForm({
      name: SHAREABLE_TRACK_METADATA_FIELDS,
      formState: { values: true },
      callback: () => {
        if (timer !== undefined) globalThis.clearTimeout(timer);
        timer = globalThis.setTimeout(
          () => setProjectedFiles(projectFilesRef.current()),
          SHARE_FINGERPRINT_DELAY_MS,
        );
      },
    });
    return () => {
      if (timer !== undefined) globalThis.clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled, subscribeToEditorForm]);

  useEffect(() => {
    const expiries: number[] = [];
    const now = Date.now();
    const publications = [
      ...library.state.albums.map((album) => album.sharePublication),
      ...library.state.files.map((file) => file.sharePublication),
    ];
    for (const publication of publications) {
      if (publication?.status !== "active") continue;
      const expiry = Date.parse(publication.expiresAt);
      if (Number.isFinite(expiry) && expiry > now) expiries.push(expiry);
    }
    if (!expiries.length) return;
    const timer = globalThis.setTimeout(
      () => setExpiryTick((tick) => tick + 1),
      Math.min(2_147_483_647, Math.max(0, Math.min(...expiries) - now + 1)),
    );
    return () => globalThis.clearTimeout(timer);
  }, [library.state.albums, library.state.files]);

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
        const files = album.trackIds.map((trackId) =>
          projectedFiles.find((file) => file.id === trackId),
        );
        if (files.some((file) => !file)) return [album.id, undefined] as const;
        try {
          const snapshot = await projectAlbumShareSnapshot(
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
  }, [library.state.albums, projectedFiles]);

  useEffect(() => {
    let canceled = false;
    const publishedTracks = projectedFiles.filter(
      (file) => file.sharePublication?.status === "active",
    );
    if (!publishedTracks.length) {
      setTrackFingerprints({});
      return () => {
        canceled = true;
      };
    }
    setTrackFingerprints((current) =>
      Object.fromEntries(publishedTracks.map((file) => [file.id, current[file.id]])),
    );
    void Promise.all(
      publishedTracks.map(async (file) => {
        try {
          const snapshot = await projectTrackShareSnapshot(file);
          return [file.id, snapshot.fingerprint] as const;
        } catch {
          return [file.id, undefined] as const;
        }
      }),
    ).then((entries) => {
      if (!canceled) setTrackFingerprints(Object.fromEntries(entries));
    });
    return () => {
      canceled = true;
    };
  }, [projectedFiles]);

  const currentLibrary = library.getSnapshot();
  const shareActions = Object.fromEntries(
    currentLibrary.albums.map((album): [string, ShareActionState] => {
      if (album.sourceManifestSlug) {
        return [album.id, shareAlbumActionState(album, undefined, false)];
      }
      const files = album.trackIds.map((trackId) =>
        currentLibrary.files.find((file) => file.id === trackId),
      );
      const eligibilityReason = shareEligibility(album, files);
      if (eligibilityReason) {
        return [
          album.id,
          {
            enabled: false,
            label: "share album",
            reason: eligibilityReason,
            variant: "create",
          },
        ];
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

  const shareTrackActions = Object.fromEntries(
    currentLibrary.files.map((file): [string, ShareActionState] => {
      if (file.sourceManifestSlug) {
        return [file.id, shareTrackActionState(file, undefined, false)];
      }
      const eligibilityReason = shareTrackEligibility(file);
      if (eligibilityReason) {
        return [
          file.id,
          {
            enabled: false,
            label: "share track",
            reason: eligibilityReason,
            variant: "create",
          },
        ];
      }
      const publication = file.sharePublication;
      return [
        file.id,
        shareTrackActionState(
          file,
          trackFingerprints[file.id],
          Boolean(publication && getPublicationCapability(publication.slug)),
        ),
      ];
    }),
  );

  const loadSlug = useCallback(
    async (slug: string) => {
      const loadId = ++pageLoadIdRef.current;
      loadingSlugRef.current = slug;
      setPage({ status: "loading", slug });
      try {
        const fetched = await fetchSharedContent(slug);
        if (loadingSlugRef.current !== slug || pageLoadIdRef.current !== loadId) return fetched;
        setPage({ status: "ready", slug, ...fetched });
        analytics.capture({
          type: "share_opened",
          shareId: fetched.analyticsId,
          shareKind: fetched.manifest.kind,
          trackCount: manifestTrackCount(fetched.manifest),
          viewer: getPublicationCapability(slug) ? "creator" : "recipient",
        });
        void detectAnotherTagiumTab().then(setAnotherTabOpen);
        return fetched;
      } catch (error) {
        if (loadingSlugRef.current !== slug || pageLoadIdRef.current !== loadId) throw error;
        setPage({
          status: "unavailable",
          slug,
          reason: error instanceof SharedContentVersionError ? "newer-version" : "unavailable",
        });
        throw error;
      }
    },
    [getPublicationCapability],
  );

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
      if (!enabled) throw new SharedContentUnavailableError();
      if (importingSlugRef.current) return;

      const snapshot = library.getSnapshot();
      const existingAlbum = snapshot.albums.find((album) => album.sourceManifestSlug === slug);
      const existingFile = snapshot.files.find((file) => file.sourceManifestSlug === slug);
      if (existingAlbum || existingFile) {
        editor.commands.flush();
        if (existingAlbum) {
          library.dispatch({ type: "album-selected", albumId: existingAlbum.id, mode: "replace" });
        } else if (existingFile) {
          selectTrack(library, existingFile.id);
        }
        return;
      }

      importingSlugRef.current = slug;
      try {
        const fresh = await fetchSharedContent(slug);
        const artworkFile = manifestArtwork(fresh.manifest) ? await fetchSharedArtwork(slug) : null;
        const convertedPicture = artworkFile
          ? await coverArtFileToPicture(artworkFile, "shared artwork")
          : undefined;
        const artwork = manifestArtwork(fresh.manifest);
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
        await importing.commands.importSharedContent(fresh.manifest, slug, picture);
        analytics.capture({
          type: "share_added",
          shareId: fresh.analyticsId,
          shareKind: fresh.manifest.kind,
          trackCount: manifestTrackCount(fresh.manifest),
        });
        toast.success(`${fresh.manifest.kind} added to your library`, {
          description: sharedContentAddedDescription(fresh.manifest),
        });
      } catch (error) {
        if (error instanceof SharedContentVersionError) throw error;
        throw new SharedContentUnavailableError();
      } finally {
        importingSlugRef.current = null;
      }
    },
    [editor.commands, enabled, importing.commands, library],
  );

  const closePage = useCallback((replace = false) => {
    loadingSlugRef.current = null;
    setPage(null);
    if (replace || !history.state?.shareSlug) history.replaceState({}, "", "/");
    else if (location.pathname.startsWith("/share/")) history.back();
  }, []);

  const openCreator = useCallback(
    async (target: ShareTarget) => {
      editor.commands.flush();
      const snapshot = library.getSnapshot();
      const album =
        target.kind === "album"
          ? snapshot.albums.find((entry) => entry.id === target.id)
          : undefined;
      const file =
        target.kind === "track"
          ? snapshot.files.find((entry) => entry.id === target.id)
          : undefined;
      if (target.kind === "album" && !album) return;
      if (target.kind === "track" && !file) return;

      const albumFiles = album
        ? album.trackIds.map((trackId) => snapshot.files.find((entry) => entry.id === trackId))
        : [];
      const sourceManifestSlug =
        target.kind === "album" ? album?.sourceManifestSlug : file?.sourceManifestSlug;
      const preview = album
        ? buildShareAlbumPreview(album, albumFiles)
        : buildShareTrackPreview(file!);

      if (sourceManifestSlug) {
        setCreatorTarget(null);
        setDialog({ status: "link", preview, url: shareLinkForSlug(sourceManifestSlug) });
        return;
      }

      const ineligibleReason = album
        ? shareEligibility(album, albumFiles)
        : shareTrackEligibility(file!);
      if (ineligibleReason) {
        toast.error(`this ${target.kind} cannot be shared`, { description: ineligibleReason });
        return;
      }

      const publication = album?.sharePublication ?? file?.sharePublication;
      let currentFingerprint: string;
      try {
        currentFingerprint = album
          ? (
              await projectAlbumShareSnapshot(
                album,
                albumFiles as NonNullable<(typeof albumFiles)[number]>[],
              )
            ).fingerprint
          : (await projectTrackShareSnapshot(file!)).fingerprint;
      } catch (error) {
        toast.error(`this ${target.kind} cannot be shared`, {
          description: sharePublicationErrorMessage(error, target.kind),
        });
        return;
      }
      const action = album
        ? shareAlbumActionState(
            album,
            currentFingerprint,
            Boolean(publication && getPublicationCapability(publication.slug)),
          )
        : shareTrackActionState(
            file!,
            currentFingerprint,
            Boolean(publication && getPublicationCapability(publication.slug)),
          );
      if (!action.enabled) {
        toast.error(action.reason);
        return;
      }

      setCreatorTarget(target);
      if (publication && action.variant === "view") {
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
        intent: action.variant === "update" ? "update" : "create",
      });
    },
    [editor.commands, getPublicationCapability, library],
  );

  const setTargetPublication = useCallback(
    (target: ShareTarget, publication: SharePublication) => {
      library.dispatch(
        target.kind === "album"
          ? { type: "album-share-publication-set", albumId: target.id, publication }
          : { type: "track-share-publication-set", fileId: target.id, publication },
      );
    },
    [library],
  );

  const publish = useCallback(async () => {
    if (
      publicationActionInFlightRef.current ||
      !creatorTarget ||
      dialog.status === "closed" ||
      dialog.status === "published" ||
      dialog.status === "link"
    )
      return;
    publicationActionInFlightRef.current = true;
    const target = creatorTarget;
    const currentDialog = dialog;
    let attemptedIntent = currentDialog.intent;
    setDialog({ ...currentDialog, status: "publishing" });
    try {
      editor.commands.flush();
      const snapshot = library.getSnapshot();
      let shareSnapshot: ShareSnapshot;
      let existingPublication: SharePublication | undefined;
      let latestAction: ShareActionState;

      if (target.kind === "album") {
        const album = snapshot.albums.find((entry) => entry.id === target.id);
        if (!album) throw new Error("the album is no longer in your library");
        const files = album.trackIds.map((trackId) => {
          const file = snapshot.files.find((entry) => entry.id === trackId);
          if (!file) throw new Error("the album has a missing track");
          return file;
        });
        existingPublication = album.sharePublication;
        shareSnapshot = await projectAlbumShareSnapshot(album, files);
        latestAction = shareAlbumActionState(
          album,
          shareSnapshot.fingerprint,
          Boolean(existingPublication && getPublicationCapability(existingPublication.slug)),
        );
      } else {
        const file = snapshot.files.find((entry) => entry.id === target.id);
        if (!file) throw new Error("the track is no longer in your library");
        existingPublication = file.sharePublication;
        shareSnapshot = await projectTrackShareSnapshot(file);
        latestAction = shareTrackActionState(
          file,
          shareSnapshot.fingerprint,
          Boolean(existingPublication && getPublicationCapability(existingPublication.slug)),
        );
      }

      const updating = latestAction.variant === "update";
      const creating = latestAction.variant === "create";
      if (!latestAction.enabled || (!updating && !creating)) throw new Error(latestAction.reason);
      attemptedIntent = updating ? "update" : "create";

      let receipt;
      let createdAnalyticsId: string | undefined;
      if (updating) {
        if (!existingPublication || !isActiveSharePublication(existingPublication)) {
          throw new Error(`the shared ${target.kind} can no longer be updated`);
        }
        const capability = getPublicationCapability(existingPublication.slug);
        if (!capability) throw new Error(`this browser cannot update the shared ${target.kind}`);
        await updateShare(
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
        receipt = await publishShare(shareSnapshot.manifest, shareSnapshot.cover);
        createdAnalyticsId = receipt.analyticsId;
        const capability = {
          slug: receipt.slug,
          expiresAt: receipt.expiresAt,
          token: receipt.revocationToken,
        };
        publicationReceiptsRef.current.set(receipt.slug, capability);
        setTargetPublication(target, {
          slug: receipt.slug,
          url: receipt.url,
          expiresAt: receipt.expiresAt,
          publishedFingerprint: shareSnapshot.fingerprint,
          status: "active",
        });
        try {
          storeRevocationReceipt(capability);
        } catch {
          try {
            await revokeShare(receipt.slug, receipt.revocationToken);
            publicationReceiptsRef.current.delete(receipt.slug);
            setTargetPublication(target, {
              slug: receipt.slug,
              url: receipt.url,
              expiresAt: receipt.expiresAt,
              publishedFingerprint: shareSnapshot.fingerprint,
              status: "stopped",
            });
          } catch {
            throw new Error("your browser did not allow tagium to save the sharing permission");
          }
          throw new Error("your browser did not allow tagium to save the sharing permission");
        }
      }
      setTargetPublication(target, {
        slug: receipt.slug,
        url: receipt.url,
        expiresAt: receipt.expiresAt,
        publishedFingerprint: shareSnapshot.fingerprint,
        status: "active",
      });
      setDialog({ status: "published", preview: currentDialog.preview, receipt });
      if (createdAnalyticsId) {
        analytics.capture({
          type: "share_created",
          shareId: createdAnalyticsId,
          shareKind: shareSnapshot.manifest.kind,
          trackCount: manifestTrackCount(shareSnapshot.manifest),
        });
      }
    } catch (error) {
      const createError = sharePublicationErrorMessage(error, target.kind).replace(/[.!?]+$/, "");
      setDialog({
        status: "error",
        preview: currentDialog.preview,
        intent: attemptedIntent,
        message:
          attemptedIntent === "update"
            ? `the shared ${target.kind} could not be updated. the link still has the previous version.`
            : createError === "the share link could not be created"
              ? `${createError}.`
              : `${createError}. no link was created.`,
      });
    } finally {
      publicationActionInFlightRef.current = false;
    }
  }, [
    creatorTarget,
    dialog,
    editor.commands,
    getPublicationCapability,
    library,
    setTargetPublication,
  ]);

  const stopDialogShare = useCallback(async () => {
    if (dialog.status !== "published") return;
    const receipt = dialog.receipt;
    await revokeShare(receipt.slug, receipt.revocationToken);
    publicationReceiptsRef.current.delete(receipt.slug);
    removeRevocationReceipt(receipt.slug);
    if (creatorTarget) {
      const publication = publicationForTarget(library.getSnapshot(), creatorTarget);
      if (publication?.slug === receipt.slug) {
        setTargetPublication(creatorTarget, { ...publication, status: "stopped" });
      }
    }
    setDialog({ status: "closed" });
    toast.success("sharing stopped", { description: "the link no longer works." });
  }, [creatorTarget, dialog, library, setTargetPublication]);

  const stopPageShare = useCallback(async () => {
    if (page?.status !== "ready") return;
    const receipt = getPublicationCapability(page.slug);
    if (!receipt) return;
    await revokeShare(page.slug, receipt.token);
    publicationReceiptsRef.current.delete(page.slug);
    removeRevocationReceipt(page.slug);
    const snapshot = library.getSnapshot();
    const album = snapshot.albums.find((entry) => entry.sharePublication?.slug === page.slug);
    const file = snapshot.files.find((entry) => entry.sharePublication?.slug === page.slug);
    if (album?.sharePublication) {
      setTargetPublication(
        { kind: "album", id: album.id },
        { ...album.sharePublication, status: "stopped" },
      );
    } else if (file?.sharePublication) {
      setTargetPublication(
        { kind: "track", id: file.id },
        { ...file.sharePublication, status: "stopped" },
      );
    }
    setPage({ status: "unavailable", slug: page.slug, reason: "unavailable" });
    toast.success("sharing stopped", { description: "the link no longer works." });
  }, [getPublicationCapability, library, page, setTargetPublication]);

  const addSharedContent = useCallback(
    async (allowDuplicate = false) => {
      if (page?.status !== "ready" || adding) return;
      const snapshot = library.getSnapshot();
      const existing =
        page.manifest.kind === "album"
          ? snapshot.albums.find((album) => album.sourceManifestSlug === page.slug)
          : snapshot.files.find((file) => file.sourceManifestSlug === page.slug);
      if (existing && !allowDuplicate) return;
      setAdding(true);
      try {
        const fresh = await fetchSharedContent(page.slug);
        const freshArtwork = manifestArtwork(fresh.manifest);
        const artworkFile = freshArtwork ? await fetchSharedArtwork(page.slug) : null;
        const convertedPicture = artworkFile
          ? await coverArtFileToPicture(artworkFile, "shared artwork")
          : undefined;
        const picture = convertedPicture?.map((entry, index) =>
          index === 0 && freshArtwork
            ? {
                ...entry,
                format: freshArtwork.format,
                type: freshArtwork.type,
                description: freshArtwork.description,
              }
            : entry,
        );
        await importing.commands.importSharedContent(fresh.manifest, page.slug, picture);
        analytics.capture({
          type: "share_added",
          shareId: fresh.analyticsId,
          shareKind: fresh.manifest.kind,
          trackCount: manifestTrackCount(fresh.manifest),
        });
        history.replaceState({}, "", "/");
        setPage(null);
        toast.success(`${fresh.manifest.kind} added to your library`, {
          description: sharedContentAddedDescription(fresh.manifest),
        });
      } catch (error) {
        if (error instanceof SharedContentUnavailableError) {
          setPage({ status: "unavailable", slug: page.slug, reason: "unavailable" });
        } else {
          toast.error(`${page.manifest.kind} could not be added`, {
            description: "your current workspace is unchanged. try again.",
          });
        }
      } finally {
        setAdding(false);
      }
    },
    [adding, importing.commands, library, page],
  );

  const alreadyAddedTargetId =
    page?.status === "ready"
      ? page.manifest.kind === "album"
        ? (library.state.albums.find((album) => album.sourceManifestSlug === page.slug)?.id ?? null)
        : (library.state.files.find((file) => file.sourceManifestSlug === page.slug)?.id ?? null)
      : null;

  const viewAlreadyAdded = useCallback(() => {
    if (!alreadyAddedTargetId || page?.status !== "ready") return;
    if (page.manifest.kind === "album") {
      library.dispatch({ type: "album-selected", albumId: alreadyAddedTargetId, mode: "replace" });
    } else {
      selectTrack(library, alreadyAddedTargetId);
    }
    history.replaceState({}, "", "/");
    setPage(null);
  }, [alreadyAddedTargetId, library, page]);

  const canStopSharing = page?.status === "ready" && Boolean(getPublicationCapability(page.slug));

  return {
    page,
    dialog,
    adding,
    anotherTabOpen,
    alreadyAddedTargetId,
    canStopSharing,
    shareActions,
    shareTrackActions,
    importFromInput,
    openCreator,
    publish,
    closeDialog: () => setDialog({ status: "closed" }),
    stopDialogShare,
    stopPageShare,
    addSharedContent,
    viewAlreadyAdded,
    back: () => closePage(false),
    openTagium: () => closePage(true),
  };
};
