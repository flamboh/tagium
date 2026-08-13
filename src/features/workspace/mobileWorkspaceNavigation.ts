import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type WorkspaceNavigation = {
  kind: "drawer" | "view";
  value: "open" | "editor" | "settings";
};

export type WorkspaceNavigationState = object & { workspaceNav?: WorkspaceNavigation };

const isObjectState = (state: unknown): state is object =>
  typeof state === "object" && state !== null;

const isWorkspaceNavigation = (navigation: unknown): navigation is WorkspaceNavigation => {
  if (navigation === null || (typeof navigation !== "object" && typeof navigation !== "function")) {
    return false;
  }
  return (
    "kind" in navigation &&
    "value" in navigation &&
    (navigation.kind === "drawer" || navigation.kind === "view") &&
    (navigation.value === "open" ||
      navigation.value === "editor" ||
      navigation.value === "settings")
  );
};

export const isWorkspaceNavigationState = (state: unknown): state is WorkspaceNavigationState =>
  isObjectState(state) && "workspaceNav" in state && isWorkspaceNavigation(state.workspaceNav);

export const workspaceHistoryState = (
  state: unknown,
  kind: "drawer" | "view",
  value: "open" | "editor" | "settings",
): WorkspaceNavigationState => {
  const nextState: WorkspaceNavigationState = isObjectState(state) ? { ...state } : {};
  nextState.workspaceNav = { kind, value };
  return nextState;
};

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
  const popPendingRef = useRef(false);
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
      const state: WorkspaceNavigationState = isObjectState(history.state)
        ? { ...history.state }
        : {};
      delete state.workspaceNav;
      history.replaceState(state, "", location.href);
      currentWorkspaceNavRef.current = undefined;
      popPendingRef.current = false;
      setDrawerOpen(false);
      pendingActionRef.current = null;
    }
  }, [drawerOpen, isMobile]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      popPendingRef.current = false;
      const nav = isWorkspaceNavigationState(event.state) ? event.state.workspaceNav : undefined;
      const previousNav = currentWorkspaceNavRef.current;
      currentWorkspaceNavRef.current = nav;
      const drawerIsOpen = mobileRef.current && nav?.kind === "drawer" && nav.value === "open";
      setDrawerOpen(drawerIsOpen);
      if (nav?.kind === "view") setActiveView(nav.value === "settings" ? "settings" : "editor");
      else if (
        !nav &&
        previousNav?.kind === "view" &&
        !(isObjectState(event.state) && "shareSlug" in event.state)
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

  useEffect(
    () => () => {
      pendingActionRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  const openDrawer = useCallback(
    (opener?: HTMLElement | null) => {
      openerRef.current =
        opener ??
        (typeof document !== "undefined" && document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      if (drawerOpen) return;
      history.pushState(workspaceHistoryState(history.state, "drawer", "open"), "", location.href);
      currentWorkspaceNavRef.current = { kind: "drawer", value: "open" };
      setDrawerOpen(true);
    },
    [drawerOpen],
  );

  const closeDrawer = useCallback(() => {
    if (!drawerOpen || popPendingRef.current) return;
    if (
      isWorkspaceNavigationState(history.state) &&
      history.state.workspaceNav?.kind === "drawer"
    ) {
      popPendingRef.current = true;
      history.back();
    } else {
      currentWorkspaceNavRef.current = undefined;
      setDrawerOpen(false);
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      action?.();
    }
  }, [drawerOpen]);

  const runAfterDrawerClose = useCallback(
    (action: () => void) => {
      if (!drawerOpen) {
        action();
        return;
      }
      if (popPendingRef.current) return;
      openerRef.current = null;
      pendingActionRef.current = action;
      closeDrawer();
    },
    [closeDrawer, drawerOpen],
  );

  const navigateToView = useCallback(
    (view: "editor" | "settings") => {
      if (activeView === view) return;
      history.pushState(workspaceHistoryState(history.state, "view", view), "", location.href);
      currentWorkspaceNavRef.current = { kind: "view", value: view };
      setActiveView(view);
    },
    [activeView, setActiveView],
  );

  const backWorkspace = useCallback(
    (afterBack?: () => void) => {
      if (popPendingRef.current) return;
      if (
        isWorkspaceNavigationState(history.state) &&
        history.state.workspaceNav?.kind === "view"
      ) {
        pendingActionRef.current = afterBack ?? null;
        popPendingRef.current = true;
        history.back();
      } else {
        setActiveView("editor");
        afterBack?.();
      }
    },
    [setActiveView],
  );

  return useMemo(
    () => ({
      isMobile,
      drawerOpen,
      openerRef,
      openDrawer,
      closeDrawer,
      runAfterDrawerClose,
      navigateToView,
      backWorkspace,
    }),
    [
      backWorkspace,
      closeDrawer,
      drawerOpen,
      isMobile,
      navigateToView,
      openDrawer,
      runAfterDrawerClose,
    ],
  );
};
