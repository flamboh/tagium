import { useState } from "react";
import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "../../support/hookTestHarness";
import {
  useMobileWorkspaceNavigation,
  type WorkspaceNavigationState,
} from "@/features/workspace/mobileWorkspaceNavigation";

type TestHistoryState = WorkspaceNavigationState & { shareSlug?: string };

describe("mobile workspace navigation history integration", () => {
  it("queues drawer actions until the tagged pop completes", async () => {
    const events = new EventTarget();
    let state: TestHistoryState | undefined = {};
    const stack: TestHistoryState[] = [state];
    let backCalls = 0;
    const history = {
      get state() {
        return state;
      },
      pushState(next: TestHistoryState) {
        state = next;
        stack.push(next);
      },
      replaceState(next: TestHistoryState) {
        state = next;
        stack[stack.length - 1] = next;
      },
      back() {
        backCalls++;
        stack.pop();
        state = stack.at(-1);
        queueMicrotask(() => {
          const event = new Event("popstate");
          Object.defineProperty(event, "state", { value: state });
          events.dispatchEvent(event);
        });
      },
    };
    vi.stubGlobal("location", { href: "/" });
    vi.stubGlobal("history", history);
    vi.stubGlobal(
      "window",
      Object.assign(events, {
        history,
        location: { href: "/" },
        matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
        setTimeout,
      }),
    );
    const hook = renderHook(() => {
      const [activeView, setActiveView] = useState<"editor" | "settings">("editor");
      const navigation = useMobileWorkspaceNavigation({
        activeView,
        setActiveView,
      });
      return { ...navigation, activeView };
    }, undefined);
    act(() => hook.result.openDrawer());
    let ran = false;
    let ignoredWhileClosing = false;
    act(() =>
      hook.result.runAfterDrawerClose(() => {
        ran = true;
      }),
    );
    act(() =>
      hook.result.runAfterDrawerClose(() => {
        ignoredWhileClosing = true;
      }),
    );
    expect(ran).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(ran).toBe(true);
    expect(ignoredWhileClosing).toBe(false);
    expect(backCalls).toBe(1);

    act(() => hook.result.navigateToView("settings"));
    expect(hook.result.activeView).toBe("settings");
    let ranAfterBack = false;
    let ignoredWhileGoingBack = false;
    act(() => hook.result.backWorkspace(() => (ranAfterBack = true)));
    act(() => hook.result.backWorkspace(() => (ignoredWhileGoingBack = true)));
    expect(ranAfterBack).toBe(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.activeView).toBe("editor");
    expect(ranAfterBack).toBe(true);
    expect(ignoredWhileGoingBack).toBe(false);
    expect(backCalls).toBe(2);

    act(() => hook.result.navigateToView("settings"));
    state = { shareSlug: "shared-album" };
    const sharePop = new Event("popstate");
    Object.defineProperty(sharePop, "state", { value: state });
    act(() => {
      events.dispatchEvent(sharePop);
    });
    expect(hook.result.activeView).toBe("settings");
    hook.unmount();
  });
});
