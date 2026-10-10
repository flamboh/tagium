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
  if (target === null) return false;
  const tagName = "tagName" in target ? target.tagName : undefined;

  return (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    ("isContentEditable" in target && target.isContentEditable === true)
  );
};

const LAYER_SELECTOR = "[role='dialog'], [role='alertdialog'], [role='menu']";

const MODAL_LAYER_SELECTOR =
  "[aria-modal='true'], [role='alertdialog'], [data-slot='dialog-content'], [data-slot='dropdown-menu-content']";

const isLayerEvent = (event: KeyboardEvent) =>
  event.defaultPrevented ||
  (event.target instanceof Element && event.target.closest(LAYER_SELECTOR) !== null) ||
  document.querySelector(MODAL_LAYER_SELECTOR) !== null;

const handleEditorKeyboardShortcut = (
  event: KeyboardEvent,
  actions: EditorKeyboardShortcutActions,
) => {
  if (actions.enabled === false) return;

  if (isEditableTarget(event.target) || isLayerEvent(event)) return;

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
