import { Option, Schema } from "effect";

export type EditorKeyboardShortcutActions = {
  enabled?: boolean;
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
  const element = Option.getOrNull(
    Schema.decodeUnknownOption(
      Schema.Struct({ tagName: Schema.String, isContentEditable: Schema.Boolean }),
    )(target),
  );
  return (
    element?.tagName === "INPUT" || element?.tagName === "TEXTAREA" || element?.isContentEditable
  );
};

const handleEditorKeyboardShortcut = (
  event: KeyboardEvent,
  actions: EditorKeyboardShortcutActions,
) => {
  if (actions.enabled === false) return;
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
