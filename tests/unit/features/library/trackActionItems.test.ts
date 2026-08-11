import { describe, expect, it, vi } from "vite-plus/test";
import { createTrackActionItems } from "@/features/library/trackActionItems";

const createItems = (overrides: Partial<Parameters<typeof createTrackActionItems>[0]> = {}) =>
  createTrackActionItems({
    retryable: false,
    canShare: true,
    shareDisabledReason: "",
    shareLabel: "share track",
    shareVariant: "create",
    onRetry: vi.fn(),
    onShare: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  });

describe("track action items", () => {
  it("puts retry first only when the track is retryable", () => {
    expect(createItems().map(({ id }) => id)).toEqual(["share", "remove"]);
    expect(createItems({ retryable: true }).map(({ id }) => id)).toEqual([
      "retry",
      "share",
      "remove",
    ]);
  });

  it("carries the explicit share variant independently from its label", () => {
    expect(
      createItems({ shareLabel: "update shared track", shareVariant: "create" })[0],
    ).toMatchObject({
      id: "share",
      label: "update shared track",
      shareVariant: "create",
    });
  });

  it("describes unavailable sharing and keeps removal destructive", () => {
    const items = createItems({
      canShare: false,
      shareDisabledReason: "local tracks cannot be shared",
    });

    expect(items[0]).toMatchObject({
      id: "share",
      disabled: true,
      description: "local tracks cannot be shared",
    });
    expect(items[1]).toMatchObject({ id: "remove", destructive: true, disabled: false });
  });
});
