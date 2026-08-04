import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import type { TrackEditorSession } from "@/features/editor/useTrackEditorSession";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import type { ActiveView } from "@/features/workspace/audioWorkspaceTypes";

type EditorDestination = "home" | "editor";

export type WorkspaceDestination =
  | { kind: EditorDestination }
  | { kind: "settings"; returnTo: EditorDestination };

export type WorkspaceNavigationAction =
  | { type: "show-editor" }
  | { type: "go-home" }
  | { type: "open-settings" }
  | { type: "go-back" };

export const transitionWorkspaceDestination = (
  destination: WorkspaceDestination,
  action: WorkspaceNavigationAction,
): WorkspaceDestination => {
  switch (action.type) {
    case "show-editor":
      return { kind: "editor" };
    case "go-home":
      return { kind: "home" };
    case "open-settings":
      return destination.kind === "settings"
        ? destination
        : { kind: "settings", returnTo: destination.kind };
    case "go-back":
      return destination.kind === "settings" ? { kind: destination.returnTo } : destination;
  }
};

type NavigationEditor = Pick<TrackEditorSession, "isCoverProcessing"> & {
  commands: Pick<TrackEditorSession["commands"], "flush">;
};

export interface WorkspaceNavigation {
  destination: WorkspaceDestination;
  activeView: ActiveView;
  showEditor: () => void;
  goHome: () => void;
  openSettings: () => void;
  goBack: () => void;
  syncView: (view: ActiveView) => void;
}

export const useWorkspaceNavigation = ({
  library,
  editor,
  initialDestination = { kind: "home" },
}: {
  library: LibraryStore;
  editor: NavigationEditor;
  initialDestination?: WorkspaceDestination;
}): WorkspaceNavigation => {
  const [destination, dispatch] = useReducer(transitionWorkspaceDestination, initialDestination);
  const destinationRef = useRef(destination);
  const editorRef = useRef(editor);
  const libraryRef = useRef(library);
  useLayoutEffect(() => {
    destinationRef.current = destination;
    editorRef.current = editor;
    libraryRef.current = library;
  }, [destination, editor, library]);

  const showEditor = useCallback(() => {
    if (editorRef.current.isCoverProcessing) return;
    dispatch({ type: "show-editor" });
  }, []);

  const goHome = useCallback(() => {
    if (editorRef.current.isCoverProcessing) return;
    editorRef.current.commands.flush();
    libraryRef.current.dispatch({ type: "selection-cleared" });
    dispatch({ type: "go-home" });
  }, []);

  const openSettings = useCallback(() => {
    if (editorRef.current.isCoverProcessing) return;
    dispatch({ type: "open-settings" });
  }, []);

  const goBack = useCallback(() => {
    if (editorRef.current.isCoverProcessing) return;
    dispatch({ type: "go-back" });
  }, []);

  const syncView = useCallback((view: ActiveView) => {
    dispatch({ type: view === "settings" ? "open-settings" : "go-back" });
  }, []);

  return useMemo(
    () => ({
      destination,
      activeView: destination.kind === "settings" ? "settings" : "editor",
      showEditor,
      goHome,
      openSettings,
      goBack,
      syncView,
    }),
    [destination, goBack, goHome, openSettings, showEditor, syncView],
  );
};
