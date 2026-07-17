export type EditorKeyboardShortcutActions = {
  selectedFileCount: number;
  isTrackCoverProcessing: boolean;
  selectAllFiles: () => void;
  requestRemoveSelectedFiles: () => void;
  clearSelection: () => void;
};

type KeyboardTarget = {
  addEventListener: (type: "keydown", listener: (event: KeyboardEvent) => void) => void;
  removeEventListener: (type: "keydown", listener: (event: KeyboardEvent) => void) => void;
};

const isEditableTarget = (target: EventTarget | null) => {
  const element = target as Pick<HTMLElement, "tagName" | "isContentEditable"> | null;
  return (
    element?.tagName === "INPUT" ||
    element?.tagName === "TEXTAREA" ||
    element?.isContentEditable === true
  );
};

const handleEditorKeyboardShortcut = (
  event: KeyboardEvent,
  actions: EditorKeyboardShortcutActions,
) => {
  if (isEditableTarget(event.target)) return;

  if ((event.ctrlKey || event.metaKey) && event.key === "a") {
    event.preventDefault();
    if (!actions.isTrackCoverProcessing) actions.selectAllFiles();
    return;
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    if (actions.selectedFileCount > 0) {
      event.preventDefault();
      if (!actions.isTrackCoverProcessing) actions.requestRemoveSelectedFiles();
    }
    return;
  }

  if (event.key === "Escape" && !actions.isTrackCoverProcessing) {
    actions.clearSelection();
  }
};

export const subscribeToEditorKeyboardShortcuts = (
  target: KeyboardTarget,
  getActions: () => EditorKeyboardShortcutActions,
) => {
  const listener = (event: KeyboardEvent) => handleEditorKeyboardShortcut(event, getActions());
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
};
