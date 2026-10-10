import { useCallback, useSyncExternalStore } from "react";
import { isValidFilenameBase } from "@/features/library/filename";
import type { TagiumFile } from "@/features/library/types";

type Listener = () => void;

/** Keeps the selected track's live filename preview out of the structural library state. */
export interface TrackFilenamePreviewStore {
  getSnapshot: (trackId: string) => string | undefined;
  getFilenameValidity: () => ReadonlyMap<string, boolean>;
  subscribe: (trackId: string, listener: Listener) => () => void;
  subscribeFilenameValidity: (listener: Listener) => () => void;
  set: (trackId: string, filename: string | undefined) => void;
}

export const createTrackFilenamePreviewStore = (): TrackFilenamePreviewStore => {
  const filenames = new Map<string, string>();
  const listeners = new Map<string, Set<Listener>>();
  const validityListeners = new Set<Listener>();
  let filenameValidity: ReadonlyMap<string, boolean> = new Map();

  return {
    getSnapshot: (trackId) => filenames.get(trackId) || undefined,
    getFilenameValidity: () => filenameValidity,
    subscribe: (trackId, listener) => {
      const trackListeners = listeners.get(trackId) ?? new Set<Listener>();
      trackListeners.add(listener);
      listeners.set(trackId, trackListeners);

      return () => {
        trackListeners.delete(listener);

        if (trackListeners.size === 0) listeners.delete(trackId);
      };
    },
    subscribeFilenameValidity: (listener) => {
      validityListeners.add(listener);

      return () => {
        validityListeners.delete(listener);
      };
    },
    set: (trackId, filename) => {
      if (filename === undefined) filenames.delete(trackId);
      else filenames.set(trackId, filename);
      listeners.get(trackId)?.forEach((listener) => listener());
      const valid = filename === undefined ? undefined : filename !== "";

      if (filenameValidity.get(trackId) === valid) return;
      filenameValidity = new Map(Array.from(filenames, ([id, value]) => [id, value !== ""]));
      validityListeners.forEach((listener) => listener());
    },
  };
};

export const useTrackFilenamePreview = (
  store: TrackFilenamePreviewStore,
  trackId: string,
  fallback: string,
) => {
  const subscribe = useCallback(
    (listener: Listener) => store.subscribe(trackId, listener),
    [store, trackId],
  );

  const getSnapshot = useCallback(() => store.getSnapshot(trackId), [store, trackId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot) ?? fallback;
};

export const useLiveTrackFilenameValidity = (store: TrackFilenamePreviewStore) => {
  const filenameValidity = useSyncExternalStore(
    store.subscribeFilenameValidity,
    store.getFilenameValidity,
    store.getFilenameValidity,
  );

  return useCallback(
    (file: TagiumFile) =>
      file.metadata !== undefined &&
      (filenameValidity.get(file.id) ?? isValidFilenameBase(file.metadata.filename)),
    [filenameValidity],
  );
};
