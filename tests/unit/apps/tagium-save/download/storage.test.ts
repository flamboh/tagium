import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createTemporaryFileStore,
  resetTemporaryStorageSessionForTests,
  startTemporaryStorageSession,
} from "@/apps/tagium-save/download/storage";

class FakeDirectory {
  readonly directories = new Map<string, FakeDirectory>();
  readonly files = new Set<string>();

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw new DOMException("missing directory", "NotFoundError");
    const directory = new FakeDirectory();
    this.directories.set(name, directory);
    return directory;
  }

  async getFileHandle(name: string) {
    this.files.add(name);
    return {
      createWritable: async () => ({
        write: async () => undefined,
        close: async () => undefined,
      }),
      getFile: async () => new File([], name),
    };
  }

  async removeEntry(name: string) {
    this.directories.delete(name);
    this.files.delete(name);
  }

  async *keys() {
    yield* this.directories.keys();
    yield* this.files;
  }
}

type FakeLock = { name: string } | null;
type FakeLockCallback = (lock: FakeLock) => Promise<void>;

const installFakeLocks = (heldNames: Iterable<string>) => {
  const held = new Set(heldNames);
  return {
    held,
    request: async (
      name: string,
      optionsOrCallback: { ifAvailable?: boolean } | FakeLockCallback,
      maybeCallback?: FakeLockCallback,
    ) => {
      const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
      const ifAvailable = typeof optionsOrCallback === "object" && optionsOrCallback.ifAvailable;
      if (!callback) throw new Error("missing lock callback");
      if (held.has(name)) {
        if (ifAvailable) return callback(null);
        throw new Error(`lock ${name} is already held`);
      }
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
};

describe("temporary video storage", () => {
  afterEach(() => {
    resetTemporaryStorageSessionForTests();
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
    const sessionDirectory = {
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
    const temporaryDirectory = { getDirectoryHandle: async () => sessionDirectory };
    const root = { getDirectoryHandle: async () => temporaryDirectory };
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

  it("reclaims media from closed pages without touching sessions open pages hold", async () => {
    const root = new FakeDirectory();
    const temporaryDirectory = await root.getDirectoryHandle("tagium-save-temporary", {
      create: true,
    });
    const closedSession = await temporaryDirectory.getDirectoryHandle("closed", { create: true });
    await closedSession.getFileHandle("tagium-video-input-closed");
    const openSession = await temporaryDirectory.getDirectoryHandle("open", { create: true });
    await openSession.getFileHandle("tagium-video-input-open");
    const locks = installFakeLocks(["tagium-save-temporary:open"]);
    vi.stubGlobal("navigator", { storage: { getDirectory: async () => root }, locks });

    const sessionId = await startTemporaryStorageSession();
    const store = await createTemporaryFileStore("tagium-video-input");

    expect(store.backend).toBe("opfs");
    expect([...temporaryDirectory.directories.keys()].sort()).toEqual(["open", sessionId].sort());
    expect(openSession.files).toEqual(new Set(["tagium-video-input-open"]));
    expect(temporaryDirectory.directories.get(sessionId)?.files.size).toBe(1);
    expect(locks.held).toEqual(
      new Set(["tagium-save-temporary:open", `tagium-save-temporary:${sessionId}`]),
    );
  });
});
