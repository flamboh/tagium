import { useCallback, useEffect, useRef, useState } from "react";

const MOBILE_QUERY = "(max-width: 767px)";

const getInitialMobile = () =>
  typeof window !== "undefined" && window.matchMedia?.(MOBILE_QUERY).matches === true;

const restoreFocus = (element: HTMLElement | null) => {
  if (!element?.isConnected) return;
  requestAnimationFrame(() => element.focus({ preventScroll: true }));
};

const focusDesktopSidebar = () => {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>('[data-mobile-library="library"] button:not([disabled])')
      ?.focus({ preventScroll: true });
  });
};

export interface MobileWorkspaceNavigation {
  isMobile: boolean;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

interface DrawerState {
  drawerOpen: boolean;
  libraryEmpty: boolean;
  restoreFocusAfterEmpty: boolean;
}

export const useMobileWorkspaceNavigation = ({
  libraryEmpty,
}: {
  libraryEmpty: boolean;
}): MobileWorkspaceNavigation => {
  const [isMobile, setIsMobile] = useState(getInitialMobile);
  const [drawerState, setDrawerState] = useState<DrawerState>({
    drawerOpen: false,
    libraryEmpty,
    restoreFocusAfterEmpty: false,
  });
  const drawerOpenRef = useRef(false);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);

  if (drawerState.libraryEmpty !== libraryEmpty) {
    setDrawerState({
      drawerOpen: libraryEmpty ? false : drawerState.drawerOpen,
      libraryEmpty,
      restoreFocusAfterEmpty: libraryEmpty && drawerState.drawerOpen,
    });
  }
  const drawerOpen = drawerState.drawerOpen;

  const openDrawer = useCallback(() => {
    if (!isMobile) return;
    drawerTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerOpenRef.current = true;
    setDrawerState((current) => ({
      ...current,
      drawerOpen: true,
      restoreFocusAfterEmpty: false,
    }));
  }, [isMobile]);

  const closeDrawer = useCallback(() => {
    drawerOpenRef.current = false;
    setDrawerState((current) => ({ ...current, drawerOpen: false }));
    restoreFocus(drawerTriggerRef.current);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => {
      setIsMobile(media.matches);
      if (!drawerOpenRef.current) return;
      drawerOpenRef.current = false;
      setDrawerState((current) => ({ ...current, drawerOpen: false }));
      if (media.matches) restoreFocus(drawerTriggerRef.current);
      else focusDesktopSidebar();
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (drawerState.restoreFocusAfterEmpty) {
      drawerOpenRef.current = false;
      restoreFocus(drawerTriggerRef.current);
    }
  }, [drawerState.restoreFocusAfterEmpty]);

  return { isMobile, drawerOpen, openDrawer, closeDrawer };
};
