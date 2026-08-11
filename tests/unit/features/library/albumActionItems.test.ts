import { describe, expect, it, vi } from "vite-plus/test";
import { createAlbumActionItems } from "@/features/library/albumActionItems";

describe("album action items", () => {
  it("keeps the locked order and exposes cleanup count and dynamic share state", () => {
    const items = createAlbumActionItems({
      cleanupSuggestionCount: 2,
      canShare: true,
      shareDisabledReason: "",
      shareLabel: "update shared album",
      shareVariant: "update",
      onEdit: vi.fn(),
      onReviewCleanup: vi.fn(),
      onShare: vi.fn(),
    });

    expect(items.map(({ id }) => id)).toEqual(["edit", "cleanup", "share"]);
    expect(items[1]).toMatchObject({
      label: "clean up tracks",
      trailingText: "2 tracks",
      disabled: false,
    });
    expect(items[2]).toMatchObject({ label: "update shared album", disabled: false });
  });

  it("always includes cleanup and carries disabled reasons without changing row height", () => {
    const items = createAlbumActionItems({
      cleanupSuggestionCount: 0,
      canShare: false,
      shareDisabledReason: "albums with local tracks cannot be shared",
      shareLabel: "share album",
      shareVariant: "create",
      onEdit: vi.fn(),
      onReviewCleanup: vi.fn(),
      onShare: vi.fn(),
    });

    expect(items[1]).toMatchObject({ trailingText: "none needed", disabled: true });
    expect(items[2]).toMatchObject({
      trailingText: "unavailable",
      description: "albums with local tracks cannot be shared",
      disabled: true,
    });
  });

  it("uses singular trailing metadata for one cleanup suggestion", () => {
    const items = createAlbumActionItems({
      cleanupSuggestionCount: 1,
      canShare: true,
      shareDisabledReason: "",
      shareLabel: "share album",
      shareVariant: "create",
      onEdit: vi.fn(),
      onReviewCleanup: vi.fn(),
      onShare: vi.fn(),
    });

    expect(items[1]).toMatchObject({ trailingText: "1 track", disabled: false });
  });
});
