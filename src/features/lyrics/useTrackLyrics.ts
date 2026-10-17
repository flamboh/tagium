import { Effect } from "effect";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyDetectedTrackTagsToFiles } from "@/features/library/fileMetadataOps";
import { createTrackFillQueue, type TrackFillQueue } from "@/features/library/trackFillQueue";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import {
  getLyricsQuery,
  lookupLyrics,
  type LyricsLookup,
  type LyricsLookupProgress,
} from "@/features/lyrics/lyricsLookup";

const LOOKUP_SPACING = "300 millis";

const noPendingTracks: ReadonlySet<string> = new Set();

const noStatuses: ReadonlyMap<string, LyricsLookupStatus> = new Map();

export type LyricsLookupStatus =
  | "queued"
  | "searching"
  | "busy"
  | "missing"
  | "instrumental"
  | "failed";

type LyricsTrack = TagiumFile & { metadata: AudioMetadata };

const isReadyForLyrics = (file: TagiumFile | undefined): file is LyricsTrack =>
  Boolean(file?.metadata && file.downloadStatus === "ready" && file.status !== "error");

const needsLyrics = (file: LyricsTrack) =>
  file.metadata.lyrics === "" &&
  file.metadata.title.trim() !== "" &&
  file.metadata.artist.trim() !== "";

export const createTrackLyricsQueue = ({
  library,
  getCurrentFiles = () => library.getSnapshot().files,
  getSettings,
  isExportRunning,
  lookup,
  onPendingChange,
  onStatusChange,
}: {
  library: Pick<LibraryStore, "getSnapshot" | "dispatch">;
  getCurrentFiles?: () => TagiumFile[];
  getSettings: () => Pick<AppSettings, "findLyrics">;
  isExportRunning: () => boolean;
  lookup: (
    metadata: AudioMetadata,
    signal: AbortSignal,
    progress: LyricsLookupProgress,
  ) => Promise<LyricsLookup>;
  onPendingChange: (trackIds: ReadonlySet<string>) => void;
  onStatusChange: (trackId: string, status: LyricsLookupStatus | undefined) => void;
}): TrackFillQueue =>
  createTrackFillQueue({
    library,
    getCurrentFiles,
    isEnabled: () => getSettings().findLyrics,
    isExportRunning,
    isReady: isReadyForLyrics,
    needsFill: needsLyrics,
    inputKey: (file) => JSON.stringify(getLyricsQuery(file.metadata)),
    run: async (file, signal) => {
      try {
        const result = await lookup(file.metadata, signal, {
          onSearching: () => onStatusChange(file.id, "searching"),
          onBusy: () => onStatusChange(file.id, "busy"),
        });

        onStatusChange(file.id, result.status === "found" ? undefined : result.status);

        return result;
      } catch (error) {
        onStatusChange(file.id, signal.aborted ? undefined : "failed");
        throw error;
      }
    },
    apply: (files, trackId, result) =>
      result.status === "found"
        ? applyDetectedTrackTagsToFiles(files, trackId, { lyrics: result.lyrics })
        : files,
    onPendingChange,
  });

export const getLyricsLookupStatus = (
  trackId: string,
  pendingTrackIds: ReadonlySet<string>,
  statuses: ReadonlyMap<string, LyricsLookupStatus>,
): LyricsLookupStatus | undefined => {
  const status = statuses.get(trackId);

  if (!pendingTrackIds.has(trackId)) return status;

  return status === "searching" || status === "busy" ? status : "queued";
};

export const useTrackLyrics = ({
  library,
  projectFiles,
  settings,
  exporting,
  isExportRunning,
}: {
  library: LibraryStore;
  projectFiles: () => TagiumFile[];
  settings: AppSettings;
  exporting: boolean;
  isExportRunning: () => boolean;
}) => {
  const [pendingTrackIds, setPendingTrackIds] = useState(noPendingTracks);
  const [statuses, setStatuses] = useState(noStatuses);
  const settingsRef = useRef(settings);
  const queueRef = useRef<TrackFillQueue | null>(null);
  const isExportRunningRef = useRef(isExportRunning);
  const projectFilesRef = useRef(projectFiles);
  useLayoutEffect(() => {
    settingsRef.current = settings;
    isExportRunningRef.current = isExportRunning;
    projectFilesRef.current = projectFiles;
  }, [isExportRunning, projectFiles, settings]);

  const setStatus = useCallback((trackId: string, status: LyricsLookupStatus | undefined) => {
    setStatuses((current) => {
      if (current.get(trackId) === status) return current;
      const next = new Map(current);

      if (status === undefined) next.delete(trackId);
      else next.set(trackId, status);

      return next;
    });
  }, []);

  const { getSnapshot, dispatch } = library;
  useEffect(() => {
    const queue = createTrackLyricsQueue({
      library: { getSnapshot, dispatch },
      getCurrentFiles: () => projectFilesRef.current(),
      getSettings: () => settingsRef.current,
      isExportRunning: () => isExportRunningRef.current(),
      lookup: (metadata, signal, progress) =>
        Effect.runPromise(
          lookupLyrics(getLyricsQuery(metadata), progress).pipe(
            Effect.ensuring(Effect.sleep(LOOKUP_SPACING)),
          ),
          { signal },
        ),
      onPendingChange: setPendingTrackIds,
      onStatusChange: setStatus,
    });

    queueRef.current = queue;

    return () => {
      queue.dispose();
      queueRef.current = null;
    };
  }, [dispatch, getSnapshot, setStatus]);

  useEffect(() => {
    queueRef.current?.sync();
  }, [exporting, library.state.files, settings.findLyrics]);

  const retry = useCallback(
    (trackId: string) => {
      setStatus(trackId, undefined);
      queueRef.current?.retry(trackId);
    },
    [setStatus],
  );

  const statusOf = (trackId: string | null) =>
    trackId === null ? undefined : getLyricsLookupStatus(trackId, pendingTrackIds, statuses);

  return { pendingTrackIds, statusOf, retry };
};
