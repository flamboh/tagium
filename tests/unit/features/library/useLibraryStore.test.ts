import { act } from "react-test-renderer";
import { describe, expect, it } from "vite-plus/test";
import { renderHook } from "../../support/hookTestHarness";
import { useLibraryStore } from "@/features/library/useLibraryStore";

describe("library store", () => {
  it("publishes eager snapshots through one writer and rerenders subscribers", () => {
    const hook = renderHook(() => useLibraryStore(), undefined);
    const store = hook.result;
    const first = {
      id: "first",
      format: "mp3" as const,
      filename: "first.mp3",
      status: "saved" as const,
      downloadStatus: "ready" as const,
    };
    const second = {
      id: "second",
      format: "mp3" as const,
      filename: "second.mp3",
      status: "saved" as const,
      downloadStatus: "ready" as const,
    };

    act(() => {
      store.dispatch({ type: "content-replaced", files: [first] });
      store.dispatch({
        type: "content-replaced",
        files: [...store.getSnapshot().files, second],
      });
      expect(store.getSnapshot().files.map((file) => file.id)).toEqual(["first", "second"]);
    });

    expect(hook.result.state.files.map((file) => file.id)).toEqual(["first", "second"]);
    hook.unmount();
  });
});
