import { useCallback, useSyncExternalStore } from "react";

type Listener = () => void;

/** Keeps the selected track's live filename preview out of the structural library state. */
export interface TrackFilenamePreviewStore {
  getSnapshot: (trackId: string) => string | undefined;
  subscribe: (trackId: string, listener: Listener) => () => void;
  set: (trackId: string, filename: string | undefined) => void;
}

export const createTrackFilenamePreviewStore = (): TrackFilenamePreviewStore => {
  const filenames = new Map<string, string>();
  const listeners = new Map<string, Set<Listener>>();

  return {
    getSnapshot: (trackId) => filenames.get(trackId),
    subscribe: (trackId, listener) => {
      const trackListeners = listeners.get(trackId) ?? new Set<Listener>();
      trackListeners.add(listener);
      listeners.set(trackId, trackListeners);
      return () => {
        trackListeners.delete(listener);
        if (trackListeners.size === 0) listeners.delete(trackId);
      };
    },
    set: (trackId, filename) => {
      if (filename === undefined) filenames.delete(trackId);
      else filenames.set(trackId, filename);
      listeners.get(trackId)?.forEach((listener) => listener());
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
