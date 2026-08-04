import { act } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";
import type { LibraryStore } from "@/features/library/useLibraryStore";
import {
  transitionWorkspaceDestination,
  useWorkspaceNavigation,
} from "@/features/workspace/workspaceNavigation";
import { renderHook } from "../../support/hookTestHarness";

describe("workspace destination transitions", () => {
  it("remembers whether settings was opened from Home or the editor", () => {
    const settingsFromHome = transitionWorkspaceDestination(
      { kind: "home" },
      { type: "open-settings" },
    );
    expect(settingsFromHome).toEqual({ kind: "settings", returnTo: "home" });
    expect(transitionWorkspaceDestination(settingsFromHome, { type: "go-back" })).toEqual({
      kind: "home",
    });

    const settingsFromEditor = transitionWorkspaceDestination(
      { kind: "editor" },
      { type: "open-settings" },
    );
    expect(settingsFromEditor).toEqual({ kind: "settings", returnTo: "editor" });
    expect(transitionWorkspaceDestination(settingsFromEditor, { type: "go-back" })).toEqual({
      kind: "editor",
    });
  });

  it("keeps the original return destination when settings is opened twice", () => {
    const settings = { kind: "settings", returnTo: "editor" } as const;
    expect(transitionWorkspaceDestination(settings, { type: "open-settings" })).toBe(settings);
  });
});

describe("workspace navigation", () => {
  it("flushes editor work before Home clears selection", () => {
    const calls: string[] = [];
    const library = {
      dispatch: vi.fn(() => {
        calls.push("clear");
      }),
    } as unknown as LibraryStore;
    const hook = renderHook(
      () =>
        useWorkspaceNavigation({
          library,
          editor: {
            isCoverProcessing: false,
            commands: {
              flush: () => {
                calls.push("flush");
                return [];
              },
            },
          },
          initialDestination: { kind: "editor" },
        }),
      undefined,
    );

    act(() => hook.result.openSettings());
    expect(hook.result.destination).toEqual({ kind: "settings", returnTo: "editor" });

    act(() => hook.result.goHome());
    expect(calls).toEqual(["flush", "clear"]);
    expect(library.dispatch).toHaveBeenCalledWith({ type: "selection-cleared" });
    expect(hook.result.destination).toEqual({ kind: "home" });
    hook.unmount();
  });

  it("blocks destination changes while cover art is processing", () => {
    const library = { dispatch: vi.fn() } as unknown as LibraryStore;
    const hook = renderHook(
      () =>
        useWorkspaceNavigation({
          library,
          editor: { isCoverProcessing: true, commands: { flush: vi.fn() } },
        }),
      undefined,
    );

    act(() => hook.result.openSettings());
    act(() => hook.result.showEditor());
    act(() => hook.result.goHome());
    expect(hook.result.destination).toEqual({ kind: "home" });
    expect(library.dispatch).not.toHaveBeenCalled();
    hook.unmount();
  });
});
