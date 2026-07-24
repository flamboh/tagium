import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "../../support/hookTestHarness";
import { useMobileWorkspaceNavigation } from "@/features/workspace/mobileWorkspaceNavigation";

describe("mobile workspace navigation history integration", () => {
  it("queues drawer actions until the tagged pop completes", async () => {
    const events = new EventTarget();
    let state: unknown = {};
    const stack: unknown[] = [state];
    const history = {
      get state() { return state; },
      pushState(next: unknown) { state = next; stack.push(next); },
      replaceState(next: unknown) { state = next; stack[stack.length - 1] = next; },
      back() { stack.pop(); state = stack.at(-1); queueMicrotask(() => { const event = new Event("popstate"); Object.defineProperty(event, "state", { value: state }); events.dispatchEvent(event); }); },
    };
    vi.stubGlobal("location", { href: "/" });
    vi.stubGlobal("history", history);
    vi.stubGlobal("window", Object.assign(events, {
      history,
      location: { href: "/" },
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
      setTimeout,
    }));
    let activeView: "editor" | "settings" = "editor";
    const hook = renderHook(() => useMobileWorkspaceNavigation({ activeView, setActiveView: (view) => { activeView = view; } }), undefined);
    act(() => hook.result.openDrawer());
    let ran = false;
    act(() => hook.result.runAfterDrawerClose(() => { ran = true; }));
    expect(ran).toBe(false);
    await act(async () => { await Promise.resolve(); });
    expect(ran).toBe(true);

    act(() => hook.result.navigateToView("settings"));
    expect(activeView).toBe("settings");
    state = { shareSlug: "shared-album" };
    const sharePop = new Event("popstate");
    Object.defineProperty(sharePop, "state", { value: state });
    act(() => {
      events.dispatchEvent(sharePop);
    });
    expect(activeView).toBe("settings");
    hook.unmount();
  });
});
