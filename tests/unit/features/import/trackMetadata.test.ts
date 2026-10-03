import { describe, expect, it } from "vitest";
import { decodeTrackMetadata } from "@/features/import/trackMetadata";

describe("track metadata", () => {
  it("rejects malformed provider metadata", async () => {
    await expect(decodeTrackMetadata({ title: 42, artist: "Burial" })).rejects.toThrow(
      "malformed track metadata response",
    );
  });
});
