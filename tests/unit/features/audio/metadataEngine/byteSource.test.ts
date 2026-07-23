import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  makeBlobByteSource,
  MAX_METADATA_READ_BYTES,
} from "@/features/audio/metadataEngine/byteSource";

describe("ByteSource", () => {
  it("reads exact bounded ranges and rejects oversized or invalid reads", async () => {
    const source = makeBlobByteSource(new Blob([Uint8Array.of(1, 2, 3, 4)]));
    expect(await Effect.runPromise(source.read(1, 2))).toEqual(Uint8Array.of(2, 3));
    await expect(Effect.runPromise(source.read(0, MAX_METADATA_READ_BYTES + 1))).rejects.toThrow(
      "safety limit",
    );
    await expect(Effect.runPromise(source.read(3, 2))).rejects.toThrow("truncated");
  });
});
