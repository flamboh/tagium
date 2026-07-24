import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type WorkspaceNavigationState = {
  workspaceNav?: { kind: "drawer" | "view"; value: "open" | "editor" | "settings" };
  [key: string]: unknown;
};

export const isWorkspaceNavigationState = (
  state: unknown,
): state is WorkspaceNavigationState => {
  if (!state || typeof state !== "object") return false;
  const nav = (state as WorkspaceNavigationState).workspaceNav;
  return Boolean(
    nav &&
      (nav.kind === "drawer" || nav.kind === "view") &&
      (nav.value === "open" || nav.value === "editor" || nav.value === "settings"),
  );
};

export const workspaceHistoryState = (
  state: unknown,
  kind: "drawer" | "view",
  value: "open" | "editor" | "settings",
): WorkspaceNavigationState => ({
  ...(state && typeof state === "object" ? state : {}),
  workspaceNav: { kind, value },
});

export const useMobileWorkspaceNavigation = ({
  activeView,
  setActiveView,
}: {
  activeView: "editor" | "settings";
  setActiveView: (view: "editor" | "settings") => void;
}) => {
  const [isMobile, setIsMobile] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const mobileRef = useRef(false);
  const pendingActionRef = useRef<(() => void) | null>(null);
  const currentWorkspaceNavRef = useRef<WorkspaceNavigationState["workspaceNav"]>(undefined);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    mobileRef.current = isMobile;
    if (!isMobile && drawerOpen) {
      const state = (history.state && typeof history.state === "object" ? { ...history.state } : {}) as WorkspaceNavigationState;
      delete state.workspaceNav;
      history.replaceState(state, "", location.href);
      currentWorkspaceNavRef.current = undefined;
      setDrawerOpen(false);
      pendingActionRef.current = null;
    }
  }, [drawerOpen, isMobile]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const nav = isWorkspaceNavigationState(event.state) ? event.state.workspaceNav : undefined;
      const previousNav = currentWorkspaceNavRef.current;
      currentWorkspaceNavRef.current = nav;
      const drawerIsOpen = mobileRef.current && nav?.kind === "drawer" && nav.value === "open";
      setDrawerOpen(drawerIsOpen);
      if (nav?.kind === "view") setActiveView(nav.value === "settings" ? "settings" : "editor");
      else if (
        !nav &&
        previousNav?.kind === "view" &&
        !(event.state && typeof event.state === "object" && "shareSlug" in event.state)
      ) {
        setActiveView("editor");
      }
      if (!drawerIsOpen) {
        const action = pendingActionRef.current;
        pendingActionRef.current = null;
        action?.();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setActiveView]);

  useEffect(() => () => { pendingActionRef.current = null; }, []);

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  const openDrawer = useCallback((opener?: HTMLElement | null) => {
    openerRef.current = opener ?? (typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (drawerOpen) return;
    history.pushState(workspaceHistoryState(history.state, "drawer", "open"), "", location.href);
    currentWorkspaceNavRef.current = { kind: "drawer", value: "open" };
    setDrawerOpen(true);
  }, [drawerOpen]);

  const closeDrawer = useCallback(() => {
    if (!drawerOpen) return;
    if (isWorkspaceNavigationState(history.state) && history.state.workspaceNav?.kind === "drawer") {
      history.back();
    } else {
      currentWorkspaceNavRef.current = undefined;
      setDrawerOpen(false);
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      action?.();
    }
  }, [drawerOpen]);

  const runAfterDrawerClose = useCallback((action: () => void) => {
    if (!drawerOpen) {
      action();
      return;
    }
    openerRef.current = null;
    pendingActionRef.current = action;
    closeDrawer();
  }, [closeDrawer, drawerOpen]);

  const navigateToView = useCallback((view: "editor" | "settings") => {
    if (activeView === view) return;
    history.pushState(workspaceHistoryState(history.state, "view", view), "", location.href);
    currentWorkspaceNavRef.current = { kind: "view", value: view };
    setActiveView(view);
  }, [activeView, setActiveView]);

  const backWorkspace = useCallback(() => {
    if (isWorkspaceNavigationState(history.state) && history.state.workspaceNav?.kind === "view") {
      history.back();
    } else {
      setActiveView("editor");
    }
  }, [setActiveView]);

  return useMemo(() => ({
    isMobile,
    drawerOpen,
    openerRef,
    openDrawer,
    closeDrawer,
    runAfterDrawerClose,
    navigateToView,
    backWorkspace,
  }), [backWorkspace, closeDrawer, drawerOpen, isMobile, navigateToView, openDrawer, runAfterDrawerClose]);
};
