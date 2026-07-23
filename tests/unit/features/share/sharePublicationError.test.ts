import { describe, expect, it } from "vite-plus/test";
import { sharePublicationErrorMessage } from "@/features/share/sharePublicationError";

describe("share publication errors", () => {
  it("replaces oversized aggregate metadata and schema diagnostics with concise share copy", () => {
    expect(
      sharePublicationErrorMessage(new Error("manifest payload must be 262144 bytes or smaller")),
    ).toBe("this album contains too much metadata to share.");
    expect(sharePublicationErrorMessage(new Error("ParseError: Expected string, actual 42"))).toBe(
      "this album contains too much metadata to share.",
    );
  });

  it("preserves intentionally user-facing request messages", () => {
    expect(
      sharePublicationErrorMessage(new Error("too many share requests; try again shortly")),
    ).toBe("too many share requests; try again shortly");
  });
});
