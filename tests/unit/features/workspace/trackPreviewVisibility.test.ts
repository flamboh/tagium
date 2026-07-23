import { describe, expect, it } from "vite-plus/test";
import { isTrackPreviewActive } from "@/features/workspace/trackPreviewVisibility";

const visibleEditor = {
  activeView: "editor" as const,
  isMobile: true,
  drawerOpen: false,
};

describe("track preview visibility", () => {
  it("stops preview when settings opens", () => {
    expect(isTrackPreviewActive({ ...visibleEditor, activeView: "settings" })).toBe(false);
  });

  it("stops preview while the mobile library drawer is open", () => {
    expect(isTrackPreviewActive({ ...visibleEditor, drawerOpen: true })).toBe(false);
  });

  it("keeps a selected preview active in every accessible editor", () => {
    expect(isTrackPreviewActive(visibleEditor)).toBe(true);
    expect(isTrackPreviewActive({ ...visibleEditor, isMobile: false })).toBe(true);
  });
});
