import { describe, expect, it, vi } from "vite-plus/test";
import {
  subscribeToEditorKeyboardShortcuts,
  type EditorKeyboardShortcutActions,
} from "@/features/editor/editorKeyboardShortcuts";

type KeyDownListener = (event: KeyboardEvent) => void;

const createKeyboardTarget = () => {
  let listener: KeyDownListener | undefined;
  return {
    addEventListener: vi.fn((_type: "keydown", nextListener: KeyDownListener) => {
      listener = nextListener;
    }),
    removeEventListener: vi.fn((_type: "keydown", currentListener: KeyDownListener) => {
      if (listener === currentListener) listener = undefined;
    }),
    dispatch(event: KeyboardEvent) {
      listener?.(event);
    },
  };
};

const preventDefaultMocks = new WeakMap<KeyboardEvent, ReturnType<typeof vi.fn>>();
const keyboardEvent = (
  key: string,
  options: Omit<Partial<KeyboardEvent>, "target"> & {
    target?: Pick<HTMLElement, "tagName" | "isContentEditable">;
  } = {},
) => {
  const event = new Event("keydown", { cancelable: true }) as KeyboardEvent;
  Object.defineProperties(event, {
    key: { value: key },
    ctrlKey: { value: options.ctrlKey ?? false },
    metaKey: { value: options.metaKey ?? false },
    target: { value: options.target ?? null },
  });
  const preventDefault = vi.spyOn(event, "preventDefault");
  preventDefaultMocks.set(event, preventDefault);
  return event;
};
const preventDefaultFor = (event: KeyboardEvent) => preventDefaultMocks.get(event);

const actions = (
  overrides: Partial<EditorKeyboardShortcutActions> = {},
): EditorKeyboardShortcutActions => ({
  selectedFileCount: 0,
  isTrackCoverProcessing: false,
  selectAllFiles: vi.fn(),
  requestRemoveSelectedFiles: vi.fn(),
  clearSelection: vi.fn(),
  ...overrides,
});

describe("editor keyboard shortcuts", () => {
  it("subscribes once and delegates to the latest actions", () => {
    const target = createKeyboardTarget();
    const initialActions = actions();
    const latestActions = actions();
    let currentActions = initialActions;

    const unsubscribe = subscribeToEditorKeyboardShortcuts(target, () => currentActions);
    const subscribedListener = target.addEventListener.mock.calls[0][1];

    currentActions = latestActions;
    target.dispatch(keyboardEvent("Escape"));
    unsubscribe();

    expect(target.addEventListener).toHaveBeenCalledOnce();
    expect(initialActions.clearSelection).not.toHaveBeenCalled();
    expect(latestActions.clearSelection).toHaveBeenCalledOnce();
    expect(target.removeEventListener).toHaveBeenCalledWith("keydown", subscribedListener);
  });

  it("uses the latest selection when deciding whether Delete is handled", () => {
    const target = createKeyboardTarget();
    const initialActions = actions();
    const latestActions = actions({ selectedFileCount: 1 });
    let currentActions = initialActions;
    subscribeToEditorKeyboardShortcuts(target, () => currentActions);
    const event = keyboardEvent("Delete");

    currentActions = latestActions;
    target.dispatch(event);

    expect(preventDefaultFor(event)).toHaveBeenCalledOnce();
    expect(initialActions.requestRemoveSelectedFiles).not.toHaveBeenCalled();
    expect(latestActions.requestRemoveSelectedFiles).toHaveBeenCalledOnce();
    expect(target.addEventListener).toHaveBeenCalledOnce();
  });

  it("handles modifier+A", () => {
    const target = createKeyboardTarget();
    const currentActions = actions();
    const event = keyboardEvent("a", { ctrlKey: true });
    subscribeToEditorKeyboardShortcuts(target, () => currentActions);

    target.dispatch(event);

    expect(preventDefaultFor(event)).toHaveBeenCalledOnce();
    expect(currentActions.selectAllFiles).toHaveBeenCalledOnce();
  });

  it("handles Delete when tracks are selected", () => {
    const target = createKeyboardTarget();
    const currentActions = actions({ selectedFileCount: 2 });
    const event = keyboardEvent("Delete");
    subscribeToEditorKeyboardShortcuts(target, () => currentActions);

    target.dispatch(event);

    expect(preventDefaultFor(event)).toHaveBeenCalledOnce();
    expect(currentActions.requestRemoveSelectedFiles).toHaveBeenCalledOnce();
  });

  it("does not claim Delete when no tracks are selected", () => {
    const target = createKeyboardTarget();
    const currentActions = actions();
    const event = keyboardEvent("Delete");
    subscribeToEditorKeyboardShortcuts(target, () => currentActions);

    target.dispatch(event);

    expect(preventDefaultFor(event)).not.toHaveBeenCalled();
    expect(currentActions.requestRemoveSelectedFiles).not.toHaveBeenCalled();
  });

  it("clears the selection on Escape", () => {
    const target = createKeyboardTarget();
    const currentActions = actions({ selectedFileCount: 1 });
    subscribeToEditorKeyboardShortcuts(target, () => currentActions);

    target.dispatch(keyboardEvent("Escape"));

    expect(currentActions.clearSelection).toHaveBeenCalledOnce();
  });

  it("leaves editor shortcuts inert outside the editor destination", () => {
    const target = createKeyboardTarget();
    const currentActions = actions({ enabled: false, selectedFileCount: 1 });
    subscribeToEditorKeyboardShortcuts(target, () => currentActions);
    const selectAllEvent = keyboardEvent("a", { ctrlKey: true });
    const deleteEvent = keyboardEvent("Delete");

    target.dispatch(selectAllEvent);
    target.dispatch(deleteEvent);
    target.dispatch(keyboardEvent("Escape"));

    expect(preventDefaultFor(selectAllEvent)).not.toHaveBeenCalled();
    expect(preventDefaultFor(deleteEvent)).not.toHaveBeenCalled();
    expect(currentActions.selectAllFiles).not.toHaveBeenCalled();
    expect(currentActions.requestRemoveSelectedFiles).not.toHaveBeenCalled();
    expect(currentActions.clearSelection).not.toHaveBeenCalled();
  });

  it("ignores shortcuts from editable targets", () => {
    const target = createKeyboardTarget();
    const currentActions = actions({ selectedFileCount: 1 });
    subscribeToEditorKeyboardShortcuts(target, () => currentActions);

    for (const targetElement of [
      { tagName: "INPUT", isContentEditable: false },
      { tagName: "TEXTAREA", isContentEditable: false },
      { tagName: "DIV", isContentEditable: true },
    ]) {
      const event = keyboardEvent("Delete", { target: targetElement });
      target.dispatch(event);

      expect(preventDefaultFor(event)).not.toHaveBeenCalled();
    }
    expect(currentActions.requestRemoveSelectedFiles).not.toHaveBeenCalled();
  });

  it("keeps shortcuts inert while track cover processing is active", () => {
    const target = createKeyboardTarget();
    const currentActions = actions({ selectedFileCount: 1, isTrackCoverProcessing: true });
    subscribeToEditorKeyboardShortcuts(target, () => currentActions);

    const selectAllEvent = keyboardEvent("a", { ctrlKey: true });
    const deleteEvent = keyboardEvent("Delete");
    target.dispatch(selectAllEvent);
    target.dispatch(deleteEvent);
    target.dispatch(keyboardEvent("Escape"));

    expect(preventDefaultFor(selectAllEvent)).toHaveBeenCalledOnce();
    expect(preventDefaultFor(deleteEvent)).toHaveBeenCalledOnce();
    expect(currentActions.selectAllFiles).not.toHaveBeenCalled();
    expect(currentActions.requestRemoveSelectedFiles).not.toHaveBeenCalled();
    expect(currentActions.clearSelection).not.toHaveBeenCalled();
  });
});
