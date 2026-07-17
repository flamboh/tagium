import { describe, expect, it } from "vite-plus/test";
import { createDownloadAdmissionWindow } from "@/features/import/downloadAdmissionWindow";

describe("downloadAdmissionWindow", () => {
  it("admits twenty ordinary tracks and makes the twenty-first wait", () => {
    const admission = createDownloadAdmissionWindow();

    for (let index = 0; index < 20; index += 1) {
      expect(admission.reserve(2, 0)).toEqual({ status: "admitted" });
    }

    expect(admission.reserve(2, 0)).toEqual({ status: "waiting", waitMs: 60_000 });
  });

  it("admits waiting work when the oldest reservation expires", () => {
    const admission = createDownloadAdmissionWindow();

    for (let index = 0; index < 20; index += 1) {
      admission.reserve(2, 0);
    }

    expect(admission.reserve(2, 59_999)).toEqual({ status: "waiting", waitMs: 1 });
    expect(admission.reserve(2, 60_000)).toEqual({ status: "admitted" });
  });

  it("calculates the first time enough mixed-cost reservations expire", () => {
    const admission = createDownloadAdmissionWindow({ maxCost: 5, windowMs: 100 });

    expect(admission.reserve(3, 0)).toEqual({ status: "admitted" });
    expect(admission.reserve(2, 10)).toEqual({ status: "admitted" });
    expect(admission.reserve(3, 20)).toEqual({ status: "waiting", waitMs: 80 });
  });
});
