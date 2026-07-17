import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const MOBILE_QUERY = "(max-width: 767px)";
const HISTORY_KEY = "__tagiumMobileWorkspace";

export type MobileWorkspacePage = "library" | "editor";

interface MobileHistoryEntry {
  token: string;
  page: "editor";
}

type HistoryState = Record<string, unknown> & {
  [HISTORY_KEY]?: MobileHistoryEntry;
};

const asHistoryState = (state: unknown): HistoryState =>
  state !== null && typeof state === "object" ? (state as HistoryState) : {};

export const addMobileWorkspaceHistoryEntry = (state: unknown, token: string): HistoryState => ({
  ...asHistoryState(state),
  [HISTORY_KEY]: { token, page: "editor" },
});

export const removeMobileWorkspaceHistoryEntry = (state: unknown): HistoryState => {
  const { [HISTORY_KEY]: _entry, ...rest } = asHistoryState(state);
  return rest;
};

export const ownsMobileWorkspaceHistoryEntry = (state: unknown, token: string): boolean => {
  const entry = asHistoryState(state)[HISTORY_KEY];
  return entry?.token === token && entry.page === "editor";
};

const getInitialMobile = () =>
  typeof window !== "undefined" && window.matchMedia?.(MOBILE_QUERY).matches === true;

const restoreFocus = (element: HTMLElement | null) => {
  if (!element?.isConnected) return;
  requestAnimationFrame(() => element.focus({ preventScroll: true }));
};

const isLibraryFocusTarget = (element: HTMLElement | null | undefined): element is HTMLElement =>
  Boolean(
    element?.isConnected && element !== document.body && element.closest("[data-mobile-library]"),
  );

const focusWorkspaceDestination = (destination: "editor" | "settings") => {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(`[data-mobile-workspace-destination="${destination}"]`)
      ?.focus({ preventScroll: true });
  });
};

export interface MobileWorkspaceNavigation {
  isMobile: boolean;
  page: MobileWorkspacePage;
  sheetOpen: boolean;
  openEditor: (destination?: "editor" | "settings", trigger?: HTMLElement | null) => void;
  backToLibrary: () => void;
  openSheet: () => void;
  closeSheet: () => void;
}

export const useMobileWorkspaceNavigation = ({
  selectedFileId,
  settingsOpen,
  libraryEmpty,
}: {
  selectedFileId: string | null;
  settingsOpen: boolean;
  libraryEmpty: boolean;
}): MobileWorkspaceNavigation => {
  const [isMobile, setIsMobile] = useState(getInitialMobile);
  const [page, setPage] = useState<MobileWorkspacePage>(() =>
    getInitialMobile() && !libraryEmpty ? "library" : "editor",
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const tokenRef = useRef(`mobile-${crypto.randomUUID()}`);
  const drillInTriggerRef = useRef<HTMLElement | null>(null);
  const sheetTriggerRef = useRef<HTMLElement | null>(null);
  const canShowEditorRef = useRef(Boolean(selectedFileId) || settingsOpen);
  const settingsOpenRef = useRef(settingsOpen);
  const isMobileRef = useRef(isMobile);
  const libraryEmptyRef = useRef(libraryEmpty);
  const previousLibraryEmptyRef = useRef(libraryEmpty);

  useLayoutEffect(() => {
    canShowEditorRef.current = Boolean(selectedFileId) || settingsOpen;
    settingsOpenRef.current = settingsOpen;
    libraryEmptyRef.current = libraryEmpty;
  }, [libraryEmpty, selectedFileId, settingsOpen]);

  const focusLibrary = useCallback(() => {
    const trigger = drillInTriggerRef.current;
    if (trigger?.isConnected) {
      restoreFocus(trigger);
      return;
    }
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-mobile-library="library"] button:not([disabled])')
        ?.focus({ preventScroll: true });
    });
  }, []);

  const transitionToLibrary = useCallback(() => {
    setSheetOpen(false);
    if (ownsMobileWorkspaceHistoryEntry(window.history.state, tokenRef.current)) {
      window.history.back();
      return;
    }
    const nextPage = libraryEmptyRef.current ? "editor" : "library";
    setPage(nextPage);
    if (nextPage === "library") focusLibrary();
    if (nextPage === "editor") {
      focusWorkspaceDestination(settingsOpenRef.current ? "settings" : "editor");
    }
  }, [focusLibrary]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => {
      isMobileRef.current = media.matches;
      setIsMobile(media.matches);
      setSheetOpen(false);
      if (!media.matches) {
        if (ownsMobileWorkspaceHistoryEntry(window.history.state, tokenRef.current)) {
          window.history.back();
        } else {
          setPage("editor");
          focusWorkspaceDestination(settingsOpenRef.current ? "settings" : "editor");
        }
        return;
      }
      transitionToLibrary();
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [transitionToLibrary]);

  useEffect(() => {
    const token = tokenRef.current;
    // A reload can retain history.state but not the in-memory library. Remove a stale marker
    // instead of fabricating an editor route that cannot safely be restored.
    if (asHistoryState(window.history.state)[HISTORY_KEY]) {
      window.history.replaceState(removeMobileWorkspaceHistoryEntry(window.history.state), "");
    }

    const onPopState = (event: PopStateEvent) => {
      if (!isMobileRef.current) {
        setSheetOpen(false);
        setPage("editor");
        focusWorkspaceDestination(settingsOpenRef.current ? "settings" : "editor");
        return;
      }
      const showEditor =
        ownsMobileWorkspaceHistoryEntry(event.state, token) && canShowEditorRef.current;
      setSheetOpen(false);
      const nextPage = showEditor || libraryEmptyRef.current ? "editor" : "library";
      setPage(nextPage);
      if (nextPage === "library") focusLibrary();
      if (nextPage === "editor") {
        focusWorkspaceDestination(settingsOpenRef.current ? "settings" : "editor");
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (ownsMobileWorkspaceHistoryEntry(window.history.state, token)) {
        window.history.replaceState(removeMobileWorkspaceHistoryEntry(window.history.state), "");
      }
    };
  }, [focusLibrary]);

  useEffect(() => {
    const wasEmpty = previousLibraryEmptyRef.current;
    previousLibraryEmptyRef.current = libraryEmpty;
    if (!isMobile || wasEmpty === libraryEmpty) return;

    if (!libraryEmpty) {
      setSheetOpen(false);
      setPage("library");
      focusLibrary();
      return;
    }
    transitionToLibrary();
  }, [focusLibrary, isMobile, libraryEmpty, transitionToLibrary]);

  useEffect(() => {
    if (!isMobile || libraryEmpty || page !== "editor" || settingsOpen || selectedFileId) return;
    transitionToLibrary();
  }, [isMobile, libraryEmpty, page, selectedFileId, settingsOpen, transitionToLibrary]);

  const openEditor = useCallback(
    (destination: "editor" | "settings" = "editor", trigger?: HTMLElement | null) => {
      if (!isMobile) return;
      if (page === "library") {
        const activeElement =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        drillInTriggerRef.current = isLibraryFocusTarget(trigger)
          ? trigger
          : isLibraryFocusTarget(activeElement)
            ? activeElement
            : null;
        window.history.pushState(
          addMobileWorkspaceHistoryEntry(window.history.state, tokenRef.current),
          "",
        );
      }
      setSheetOpen(false);
      setPage("editor");
      focusWorkspaceDestination(destination);
    },
    [isMobile, page],
  );

  const backToLibrary = useCallback(() => {
    if (!isMobile) return;
    transitionToLibrary();
  }, [isMobile, transitionToLibrary]);

  const openSheet = useCallback(() => {
    if (!isMobile || page !== "editor") return;
    sheetTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSheetOpen(true);
  }, [isMobile, page]);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    restoreFocus(sheetTriggerRef.current);
  }, []);

  return {
    isMobile,
    page,
    sheetOpen,
    openEditor,
    backToLibrary,
    openSheet,
    closeSheet,
  };
};
