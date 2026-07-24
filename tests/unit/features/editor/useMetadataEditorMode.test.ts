import { act } from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";
import { useMetadataEditorMode } from "@/features/editor/useMetadataEditorMode";
import { renderHook } from "../../support/hookTestHarness";

describe("metadata editor mode", () => {
  it("retains advanced mode until the setting is disabled", () => {
    const hook = renderHook(({ enabled }: { enabled: boolean }) => useMetadataEditorMode(enabled), {
      enabled: true,
    });

    act(() => hook.result.setMode("advanced"));
    hook.rerender({ enabled: true });
    expect(hook.result.mode).toBe("advanced");

    hook.rerender({ enabled: false });
    expect(hook.result.mode).toBe("normal");

    hook.rerender({ enabled: true });
    expect(hook.result.mode).toBe("normal");
    hook.unmount();
  });
});
