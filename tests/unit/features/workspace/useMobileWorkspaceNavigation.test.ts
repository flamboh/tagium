import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook } from "../../support/hookTestHarness";
import {
  addMobileWorkspaceHistoryEntry,
  ownsMobileWorkspaceHistoryEntry,
  removeMobileWorkspaceHistoryEntry,
  useMobileWorkspaceNavigation,
} from "@/features/workspace/useMobileWorkspaceNavigation";

class FakeMobileWindow extends EventTarget {
  private states: unknown[] = [{ hostRouter: "preserved" }];
  private index = 0;

  private media = new EventTarget() as EventTarget & { matches: boolean };

  matchMedia = () => this.media;

  history = {
    get state() {
      return undefined as unknown;
    },
    pushState: (_state: unknown, _title: string) => {},
    replaceState: (_state: unknown, _title: string) => {},
    back: () => {},
  };

  constructor() {
    super();
    this.media.matches = true;
    Object.defineProperty(this.history, "state", {
      get: () => this.states[this.index],
    });
    this.history.pushState = (state) => {
      this.states.splice(this.index + 1, Infinity, state);
      this.index++;
    };
    this.history.replaceState = (state) => {
      this.states[this.index] = state;
    };
    this.history.back = () => {
      if (this.index === 0) return;
      this.index--;
      const event = new Event("popstate") as Event & { state: unknown };
      Object.defineProperty(event, "state", { value: this.states[this.index] });
      this.dispatchEvent(event);
    };
  }

  resize(matches: boolean) {
    this.media.matches = matches;
    this.media.dispatchEvent(new Event("change"));
  }
}

class FakeHTMLElement {
  isConnected = true;
  focused = false;
  constructor(
    private readonly onFocus: () => void = () => {},
    private readonly inLibrary = false,
  ) {}
  focus() {
    this.focused = true;
    this.onFocus();
  }
  closest(selector: string) {
    return selector === "[data-mobile-library]" && this.inLibrary ? this : null;
  }
}

const installBrowserGlobals = (fakeWindow: FakeMobileWindow) => {
  const fakeDocument = {
    activeElement: null as FakeHTMLElement | null,
    querySelector: (_selector: string): FakeHTMLElement | null => null,
  };
  const editor = new FakeHTMLElement(() => {
    fakeDocument.activeElement = editor;
  });
  const settings = new FakeHTMLElement(() => {
    fakeDocument.activeElement = settings;
  });
  const library = new FakeHTMLElement(() => {
    fakeDocument.activeElement = library;
  }, true);
  fakeDocument.activeElement = library;
  fakeDocument.querySelector = (selector: string) => {
    if (selector.includes('="editor"')) return editor;
    if (selector.includes('="settings"')) return settings;
    if (selector.includes("data-mobile-library")) return library;
    return null;
  };
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("HTMLElement", FakeHTMLElement);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  return { editor, settings, library, fakeDocument };
};

afterEach(() => vi.unstubAllGlobals());

describe("mobile workspace history", () => {
  it("preserves unrelated history state while adding an owned editor entry", () => {
    const state = addMobileWorkspaceHistoryEntry({ analytics: "keep" }, "session-a");

    expect(state).toMatchObject({ analytics: "keep" });
    expect(ownsMobileWorkspaceHistoryEntry(state, "session-a")).toBe(true);
    expect(ownsMobileWorkspaceHistoryEntry(state, "session-b")).toBe(false);
  });

  it("removes only Tagium's marker from a stale reload entry", () => {
    const state = addMobileWorkspaceHistoryEntry({ router: { index: 3 } }, "old-session");

    expect(removeMobileWorkspaceHistoryEntry(state)).toEqual({ router: { index: 3 } });
  });

  it("does not claim malformed or foreign history state", () => {
    expect(ownsMobileWorkspaceHistoryEntry(null, "session-a")).toBe(false);
    expect(ownsMobileWorkspaceHistoryEntry({ __tagiumMobileWorkspace: true }, "session-a")).toBe(
      false,
    );
  });

  it("pushes one owned editor entry and consumes it when returning to the library", () => {
    const fakeWindow = new FakeMobileWindow();
    installBrowserGlobals(fakeWindow);
    const hook = renderHook(
      (props: { selectedFileId: string | null }) =>
        useMobileWorkspaceNavigation({
          selectedFileId: props.selectedFileId,
          settingsOpen: false,
          libraryEmpty: false,
        }),
      { selectedFileId: "track-a" } as { selectedFileId: string | null },
    );

    expect(hook.result.page).toBe("library");
    act(() => hook.result.openEditor());
    expect(hook.result.page).toBe("editor");
    expect(fakeWindow.history.state).toMatchObject({ hostRouter: "preserved" });

    act(() => hook.result.backToLibrary());
    expect(hook.result.page).toBe("library");
    expect(fakeWindow.history.state).toEqual({ hostRouter: "preserved" });
    hook.unmount();
  });

  it("restores the drill-in trigger when native browser Back resolves to the library", () => {
    const fakeWindow = new FakeMobileWindow();
    const browser = installBrowserGlobals(fakeWindow);
    const hook = renderHook(
      () =>
        useMobileWorkspaceNavigation({
          selectedFileId: "track-a",
          settingsOpen: false,
          libraryEmpty: false,
        }),
      undefined,
    );

    act(() => hook.result.openEditor());
    expect(browser.fakeDocument.activeElement).toBe(browser.editor);
    act(() => fakeWindow.history.back());
    expect(hook.result.page).toBe("library");
    expect(browser.fakeDocument.activeElement).toBe(browser.library);
    hook.unmount();
  });

  it("restores the tapped track when pointer activation leaves focus on body", () => {
    const fakeWindow = new FakeMobileWindow();
    const browser = installBrowserGlobals(fakeWindow);
    const body = new FakeHTMLElement();
    Object.assign(browser.fakeDocument, { activeElement: body, body });
    const hook = renderHook(
      () =>
        useMobileWorkspaceNavigation({
          selectedFileId: "track-a",
          settingsOpen: false,
          libraryEmpty: false,
        }),
      undefined,
    );

    act(() => hook.result.openEditor("editor", browser.library as unknown as HTMLElement));
    expect(browser.fakeDocument.activeElement).toBe(browser.editor);
    act(() => fakeWindow.history.back());
    expect(hook.result.page).toBe("library");
    expect(browser.fakeDocument.activeElement).toBe(browser.library);
    hook.unmount();
  });

  it("consumes its marker across desktop resize before a later mobile drill-in", () => {
    const fakeWindow = new FakeMobileWindow();
    installBrowserGlobals(fakeWindow);
    const hook = renderHook(
      () =>
        useMobileWorkspaceNavigation({
          selectedFileId: "track-a",
          settingsOpen: false,
          libraryEmpty: false,
        }),
      undefined,
    );

    act(() => hook.result.openEditor());
    act(() => fakeWindow.resize(false));
    expect(hook.result.isMobile).toBe(false);
    expect(hook.result.page).toBe("editor");
    expect(fakeWindow.history.state).toEqual({ hostRouter: "preserved" });

    act(() => fakeWindow.resize(true));
    expect(hook.result.page).toBe("library");
    act(() => hook.result.openEditor());
    act(() => hook.result.backToLibrary());
    expect(hook.result.page).toBe("library");
    expect(fakeWindow.history.state).toEqual({ hostRouter: "preserved" });
    hook.unmount();
  });

  it("consumes its marker when selection disappears before reentering", () => {
    const fakeWindow = new FakeMobileWindow();
    installBrowserGlobals(fakeWindow);
    const hook = renderHook(
      (props: { selectedFileId: string | null }) =>
        useMobileWorkspaceNavigation({
          selectedFileId: props.selectedFileId,
          settingsOpen: false,
          libraryEmpty: false,
        }),
      { selectedFileId: "track-a" } as { selectedFileId: string | null },
    );

    act(() => hook.result.openEditor());
    hook.rerender({ selectedFileId: null });
    expect(hook.result.page).toBe("library");
    expect(fakeWindow.history.state).toEqual({ hostRouter: "preserved" });

    hook.rerender({ selectedFileId: "track-a" });
    act(() => hook.result.openEditor());
    act(() => hook.result.backToLibrary());
    expect(hook.result.page).toBe("library");
    hook.unmount();
  });

  it("moves focus out of the inert library and restores it on Back and sheet close", () => {
    const fakeWindow = new FakeMobileWindow();
    const browser = installBrowserGlobals(fakeWindow);
    const hook = renderHook(
      () =>
        useMobileWorkspaceNavigation({
          selectedFileId: "track-a",
          settingsOpen: false,
          libraryEmpty: false,
        }),
      undefined,
    );

    act(() => hook.result.openEditor());
    expect(browser.editor.focused).toBe(true);
    expect(browser.fakeDocument.activeElement).toBe(browser.editor);
    act(() => hook.result.backToLibrary());
    expect(browser.library.focused).toBe(true);
    expect(browser.fakeDocument.activeElement).toBe(browser.library);

    browser.fakeDocument.activeElement = browser.editor;
    act(() => hook.result.openEditor());
    act(() => hook.result.openSheet());
    act(() => hook.result.closeSheet());
    expect(browser.editor.focused).toBe(true);
    expect(browser.fakeDocument.activeElement).toBe(browser.editor);
    hook.unmount();
  });
});
