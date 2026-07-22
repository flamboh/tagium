import { describe, expect, it } from "vite-plus/test";
import { disableShareThenDeleteArtwork } from "../../../server/utils/share-manifest-maintenance";

describe("maintainer share takedown", () => {
  it("disables before deleting and leaves a retryable disabled record on R2 failure", async () => {
    const calls: string[] = [];
    const result = await disableShareThenDeleteArtwork({
      disable: async () => {
        calls.push("disable");
        return { found: true, artworkKey: "shares/a/cover.jpg" };
      },
      deleteArtwork: async () => {
        calls.push("delete");
        throw new Error("R2 unavailable");
      },
    });
    expect(result).toBe("artwork_delete_failed");
    expect(calls).toEqual(["disable", "delete"]);
  });

  it("is idempotent when the record is already disabled or absent", async () => {
    await expect(
      disableShareThenDeleteArtwork({
        disable: async () => ({ found: false }),
        deleteArtwork: async () => {},
      }),
    ).resolves.toBe("not_found");
    await expect(
      disableShareThenDeleteArtwork({
        disable: async () => ({ found: true, artworkKey: "shares/a/cover.jpg" }),
        deleteArtwork: async () => {},
      }),
    ).resolves.toBe("disabled");
  });
});
