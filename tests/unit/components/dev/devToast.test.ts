import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { spawnDevToast, type DevToastKind } from "@/components/dev/devToast";

const toastMocks = vi.hoisted(() => {
  const neutral = vi.fn();
  return Object.assign(neutral, {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  });
});

vi.mock("sonner", () => ({ toast: toastMocks }));

beforeEach(() => {
  toastMocks.mockClear();
  toastMocks.success.mockClear();
  toastMocks.error.mockClear();
  toastMocks.info.mockClear();
  toastMocks.warning.mockClear();
});

describe("dev toast controls", () => {
  it.each(["success", "error", "info", "warning"] as const)("spawns a %s toast", (kind) => {
    spawnDevToast(kind);

    expect(toastMocks[kind]).toHaveBeenCalledWith(`${kind} toast`, {
      description: "previewing Tagium's notification styling",
    });
  });

  it("spawns a neutral toast", () => {
    spawnDevToast("neutral" satisfies DevToastKind);

    expect(toastMocks).toHaveBeenCalledWith("neutral toast", {
      description: "previewing Tagium's notification styling",
    });
  });
});
