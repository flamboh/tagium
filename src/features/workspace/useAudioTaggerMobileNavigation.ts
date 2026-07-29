import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  decideDrawerSwipe,
  getDrawerSwipeDirection,
  type SwipeDirection,
} from "@/features/workspace/drawerSwipe";
import { useMobileWorkspaceNavigation } from "@/features/workspace/mobileWorkspaceNavigation";
import type { ActiveView, SetActiveView } from "@/features/workspace/audioWorkspaceTypes";
import type { AudioWorkspace } from "@/features/workspace/useAudioWorkspace";

export const useAudioTaggerMobileNavigation = ({
  activeView,
  setActiveView,
  workspace,
}: {
  activeView: ActiveView;
  setActiveView: SetActiveView;
  workspace: Pick<AudioWorkspace, "sidebarProps" | "settingsPageProps">;
}) => {
  const navigation = useMobileWorkspaceNavigation({ activeView, setActiveView });
  const drawerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const wasDrawerOpenRef = useRef(false);
  const sidebarProps = {
    ...workspace.sidebarProps,
    onSelectAlbum: (albumId: string, event?: ReactMouseEvent) => {
      navigation.runAfterDrawerClose(() => workspace.sidebarProps.onSelectAlbum(albumId, event));
    },
    onSelectFile: (albumId: string, fileId: string, event?: ReactMouseEvent) => {
      navigation.runAfterDrawerClose(() =>
        workspace.sidebarProps.onSelectFile(albumId, fileId, event),
      );
    },
    onSelectLooseTrack: (fileId: string, event?: ReactMouseEvent) => {
      navigation.runAfterDrawerClose(() =>
        workspace.sidebarProps.onSelectLooseTrack(fileId, event),
      );
    },
    onEditAlbum: (albumId: string) =>
      navigation.runAfterDrawerClose(() => workspace.sidebarProps.onEditAlbum(albumId)),
    onAddAlbum: () => navigation.runAfterDrawerClose(workspace.sidebarProps.onAddAlbum),
    onRemoveFile: (fileId: string) =>
      navigation.runAfterDrawerClose(() => workspace.sidebarProps.onRemoveFile(fileId)),
    onPromptCreateAlbumFromLooseTracks: (source: string, target: string) =>
      navigation.runAfterDrawerClose(() =>
        workspace.sidebarProps.onPromptCreateAlbumFromLooseTracks(source, target),
      ),
    onOpenSettings: () =>
      navigation.runAfterDrawerClose(() => {
        if (workspace.sidebarProps.settingsOpen) navigation.backWorkspace();
        else navigation.navigateToView("settings");
      }),
  };
  const settingsPageProps = {
    ...workspace.settingsPageProps,
    onBack: () => navigation.runAfterDrawerClose(navigation.backWorkspace),
  };

  useEffect(() => {
    if (!navigation.drawerOpen) {
      if (wasDrawerOpenRef.current) {
        const opener = navigation.openerRef.current ?? menuButtonRef.current;
        const restore = () => opener?.isConnected && opener.focus();
        restore();
        const timer = window.setTimeout(restore, 120);
        navigation.openerRef.current = null;
        wasDrawerOpenRef.current = false;
        return () => window.clearTimeout(timer);
      }
      wasDrawerOpenRef.current = false;
      return;
    }
    wasDrawerOpenRef.current = true;
    const drawer = drawerRef.current;
    const selector = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
    const getItems = () =>
      Array.from(drawer?.querySelectorAll<HTMLElement>(selector) ?? []).filter((item) => {
        const style = window.getComputedStyle(item);
        return (
          !item.hasAttribute("disabled") &&
          item.getAttribute("aria-hidden") !== "true" &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      });
    drawer?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        navigation.closeDrawer();
        return;
      }
      if (event.key !== "Tab" || !drawer) return;
      const items = getItems();
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? index <= 0
          ? items.length - 1
          : index - 1
        : (index + 1) % items.length;
      event.preventDefault();
      items[next]?.focus();
    };
    document.addEventListener("keydown", trap);
    return () => document.removeEventListener("keydown", trap);
  }, [navigation]);

  useEffect(() => {
    if (!navigation.isMobile) return;
    let start: {
      clientX: number;
      clientY: number;
      pointerType?: string;
      pointerId?: number;
    } | null = null;
    let direction: SwipeDirection | null = null;
    let locked = false;
    const down = (event: PointerEvent) => {
      direction = getDrawerSwipeDirection(
        event,
        window.innerWidth,
        navigation.drawerOpen,
        event.target,
      );
      if (!direction) return;
      start = event;
      locked = false;
    };
    const move = (event: PointerEvent) => {
      if (!start || !direction || event.pointerId !== start.pointerId || locked) return;
      const decision = decideDrawerSwipe(start, event, direction);
      if (decision === "open") {
        navigation.openDrawer();
        locked = true;
      } else if (decision === "close") {
        navigation.closeDrawer();
        locked = true;
      } else if (decision === "ignore") {
        locked = true;
      }
    };
    const clear = () => {
      start = null;
      direction = null;
      locked = false;
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, [navigation]);

  useEffect(() => {
    if (!navigation.isMobile || !navigation.drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [navigation.drawerOpen, navigation.isMobile]);

  return {
    navigation,
    drawerRef,
    menuButtonRef,
    sidebarProps,
    settingsPageProps,
  };
};
