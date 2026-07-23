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

export const useMobileWorkspaceNavigation = ({
  libraryEmpty,
}: {
  libraryEmpty: boolean;
}): MobileWorkspaceNavigation => {
  const [isMobile, setIsMobile] = useState(getInitialMobile);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerOpenRef = useRef(false);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const previousLibraryEmptyRef = useRef(libraryEmpty);

  const openDrawer = useCallback(() => {
    if (!isMobile) return;
    drawerTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerOpenRef.current = true;
    setDrawerOpen(true);
  }, [isMobile]);

  const closeDrawer = useCallback(() => {
    drawerOpenRef.current = false;
    setDrawerOpen(false);
    restoreFocus(drawerTriggerRef.current);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => {
      setIsMobile(media.matches);
      if (!drawerOpenRef.current) return;
      drawerOpenRef.current = false;
      setDrawerOpen(false);
      if (media.matches) restoreFocus(drawerTriggerRef.current);
      else focusDesktopSidebar();
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const wasEmpty = previousLibraryEmptyRef.current;
    previousLibraryEmptyRef.current = libraryEmpty;
    if (!wasEmpty && libraryEmpty && drawerOpen) restoreFocus(drawerTriggerRef.current);
  }, [drawerOpen, libraryEmpty]);

  return { isMobile, drawerOpen: drawerOpen && !libraryEmpty, openDrawer, closeDrawer };
};
