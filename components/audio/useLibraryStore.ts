import { useState, useSyncExternalStore } from "react";
import {
  createLibraryState,
  libraryReducer,
  type LibraryAction,
  type LibraryState,
} from "./libraryState";

type Listener = () => void;

/**
 * Internal synchronization seam for the audio-workflow cluster.
 *
 * Domain behavior stays in the workflow modules and `libraryReducer`; this store only guarantees
 * that every workflow reads the same eager snapshot and that every write crosses one reducer-owned
 * writer before React subscribers render. Exposing the reducer's state and domain actions here is
 * deliberate: wrapping each action in a one-line store method would create a shallow pass-through
 * interface without hiding any additional invariant.
 */
export interface LibraryStore {
  state: LibraryState;
  getSnapshot: () => LibraryState;
  dispatch: (action: LibraryAction) => void;
}

const createLibraryStore = (initialState = createLibraryState()) => {
  let snapshot = initialState;
  const listeners = new Set<Listener>();

  return {
    getSnapshot: () => snapshot,
    dispatch: (action: LibraryAction) => {
      snapshot = libraryReducer(snapshot, action);
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

export const useLibraryStore = (): LibraryStore => {
  const [store] = useState(createLibraryStore);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return {
    state,
    getSnapshot: store.getSnapshot,
    dispatch: store.dispatch,
  };
};
