import { describe, expect, it, vi } from "vite-plus/test";
import { createAlbumActionItems } from "@/features/library/albumActionItems";

describe("album action items", () => {
  it("keeps the locked order and exposes cleanup count and dynamic share state", () => {
    const items = createAlbumActionItems({
      cleanupSuggestionCount: 2,
      canShare: true,
      shareDisabledReason: "",
      shareLabel: "update shared album",
      onEdit: vi.fn(),
      onReviewCleanup: vi.fn(),
      onShare: vi.fn(),
    });

    expect(items.map(({ id }) => id)).toEqual(["edit", "cleanup", "share"]);
    expect(items[1]).toMatchObject({
      label: "clean up titles…",
      secondaryText: "2 suggestions",
      disabled: false,
    });
    expect(items[2]).toMatchObject({ label: "update shared album", disabled: false });
  });

  it("always includes cleanup and carries disabled reasons as secondary text", () => {
    const items = createAlbumActionItems({
      cleanupSuggestionCount: 0,
      canShare: false,
      shareDisabledReason: "albums with local tracks cannot be shared",
      shareLabel: "share album",
      onEdit: vi.fn(),
      onReviewCleanup: vi.fn(),
      onShare: vi.fn(),
    });

    expect(items[1]).toMatchObject({ secondaryText: "none needed", disabled: true });
    expect(items[2]).toMatchObject({
      secondaryText: "albums with local tracks cannot be shared",
      disabled: true,
    });
  });
});
