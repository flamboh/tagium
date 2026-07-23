import { act } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook } from "../../support/hookTestHarness";
import { useMobileWorkspaceNavigation } from "@/features/workspace/useMobileWorkspaceNavigation";

class FakeMobileWindow {
  private media = new EventTarget() as EventTarget & { matches: boolean };

  constructor() {
    this.media.matches = true;
  }

  matchMedia = () => this.media;

  resize(matches: boolean) {
    this.media.matches = matches;
    this.media.dispatchEvent(new Event("change"));
  }
}

class FakeHTMLElement {
  isConnected = true;
  focused = false;

  focus() {
    this.focused = true;
  }
}

const installBrowserGlobals = (fakeWindow: FakeMobileWindow) => {
  const trigger = new FakeHTMLElement();
  const desktopSidebarControl = new FakeHTMLElement();
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", {
    activeElement: trigger,
    querySelector: (selector: string) =>
      selector.includes('data-mobile-library="library"') ? desktopSidebarControl : null,
  });
  vi.stubGlobal("HTMLElement", FakeHTMLElement);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  return { desktopSidebarControl, trigger };
};

afterEach(() => vi.unstubAllGlobals());

describe("mobile workspace drawer", () => {
  it("starts on the main surface and restores opener focus when the drawer closes", () => {
    const fakeWindow = new FakeMobileWindow();
    const { trigger } = installBrowserGlobals(fakeWindow);
    const hook = renderHook(() => useMobileWorkspaceNavigation({ libraryEmpty: false }), undefined);

    expect(hook.result.isMobile).toBe(true);
    expect(hook.result.drawerOpen).toBe(false);
    act(() => hook.result.openDrawer());
    expect(hook.result.drawerOpen).toBe(true);
    act(() => hook.result.closeDrawer());
    expect(hook.result.drawerOpen).toBe(false);
    expect(trigger.focused).toBe(true);
    hook.unmount();
  });

  it("closes when removing the final track reveals the empty download page", () => {
    const fakeWindow = new FakeMobileWindow();
    const { trigger } = installBrowserGlobals(fakeWindow);
    const hook = renderHook(
      (props: { libraryEmpty: boolean }) =>
        useMobileWorkspaceNavigation({ libraryEmpty: props.libraryEmpty }),
      { libraryEmpty: false },
    );

    act(() => hook.result.openDrawer());
    expect(hook.result.drawerOpen).toBe(true);
    hook.rerender({ libraryEmpty: true });
    expect(hook.result.drawerOpen).toBe(false);
    expect(trigger.focused).toBe(true);

    act(() => hook.result.openDrawer());
    expect(hook.result.drawerOpen).toBe(true);
    act(() => hook.result.closeDrawer());

    trigger.focused = false;
    hook.rerender({ libraryEmpty: false });
    expect(hook.result.drawerOpen).toBe(false);
    expect(trigger.focused).toBe(false);
    hook.unmount();
  });

  it("closes across breakpoints and cannot open on desktop", () => {
    const fakeWindow = new FakeMobileWindow();
    const { desktopSidebarControl, trigger } = installBrowserGlobals(fakeWindow);
    const hook = renderHook(() => useMobileWorkspaceNavigation({ libraryEmpty: false }), undefined);

    act(() => hook.result.openDrawer());
    act(() => fakeWindow.resize(false));
    expect(hook.result.isMobile).toBe(false);
    expect(hook.result.drawerOpen).toBe(false);
    expect(desktopSidebarControl.focused).toBe(true);
    expect(trigger.focused).toBe(false);
    act(() => hook.result.openDrawer());
    expect(hook.result.drawerOpen).toBe(false);

    act(() => fakeWindow.resize(true));
    expect(hook.result.isMobile).toBe(true);
    expect(hook.result.drawerOpen).toBe(false);
    hook.unmount();
  });
});
