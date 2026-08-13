import { describe, expect, it } from "vitest";
import {
  isWorkspaceNavigationState,
  workspaceHistoryState,
} from "@/features/workspace/mobileWorkspaceNavigation";

describe("workspace navigation history", () => {
  it("preserves unrelated history state such as share workflow markers", () => {
    const state = { shareSlug: "album-123" };
    const next = workspaceHistoryState(state, "drawer", "open");
    expect(next).toMatchObject({
      shareSlug: "album-123",
      workspaceNav: { kind: "drawer", value: "open" },
    });
  });

  it("recognizes only tagged workspace entries", () => {
    expect(isWorkspaceNavigationState(workspaceHistoryState({}, "view", "settings"))).toBe(true);
    expect(isWorkspaceNavigationState({ shareSlug: "album-123" })).toBe(false);
  });
});
