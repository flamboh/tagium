import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createTemporaryFileStore } from "@/apps/tagium-save/download/storage";

describe("temporary video storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("falls back to memory and releases patches on cleanup", async () => {
    const store = await createTemporaryFileStore("test-video");
    expect(store.backend).toBe("memory");

    await store.write(2, Uint8Array.of(3, 4));
    await store.write(0, Uint8Array.of(1, 2));
    const lease = await store.toBlob("video/mp4");
    expect(new Uint8Array(await lease.value.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3, 4));

    await lease.release();
    await lease.release();
    await expect(store.toBlob()).rejects.toThrow("cleaned up");
    await expect(store.write(0, Uint8Array.of(1))).rejects.toThrow("cleaned up");
  });

  it("leases an OPFS file without materializing its bytes and releases it explicitly", async () => {
    const lifecycle: string[] = [];
    const backingFile = new File([Uint8Array.of(1, 2, 3, 4)], "backing.bin");
    const readBackingFile = vi.spyOn(backingFile, "arrayBuffer").mockImplementation(async () => {
      lifecycle.push("read");
      return Uint8Array.of(1, 2, 3, 4).buffer;
    });
    const root = {
      getFileHandle: async () => ({
        createWritable: async () => ({
          write: async () => undefined,
          close: async () => undefined,
        }),
        getFile: async () => backingFile,
      }),
      removeEntry: async () => {
        lifecycle.push("remove");
      },
    };
    vi.stubGlobal("navigator", {
      storage: { getDirectory: async () => root },
    });

    const store = await createTemporaryFileStore("test-opfs-video");
    await store.write(0, Uint8Array.of(1, 2, 3, 4));
    const lease = await store.toFile("download.mp4", "video/mp4");

    expect(store.backend).toBe("opfs");
    expect(readBackingFile).not.toHaveBeenCalled();
    expect(lease.value).toBeInstanceOf(File);
    expect(lease.opfsEntryName).toBeTypeOf("string");
    expect(lifecycle).toEqual([]);

    await lease.release();
    await lease.release();

    expect(lifecycle).toEqual(["remove"]);
  });
});
