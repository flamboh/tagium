/**
 * Random-access temporary storage used by LibAV's writer device.
 *
 * OPFS keeps the encoded output out of the JavaScript heap on browsers that
 * support it. The patch store is intentionally small and only acts as a
 * fallback for browsers without OPFS (and for tests).
 */

export type TemporaryFileStoreBackend = "opfs" | "memory";

/** A finalized media value whose backing storage stays alive until release. */
export interface TemporaryFileLease<Value extends Blob> {
  readonly value: Value;
  readonly opfsEntryName?: string;
  readonly release: () => Promise<void>;
}

export interface TemporaryFileStore {
  readonly backend: TemporaryFileStoreBackend;
  readonly size: number;
  write: (position: number, data: Uint8Array) => Promise<void>;
  append: (data: Uint8Array) => Promise<void>;
  toBlob: (type?: string) => Promise<TemporaryFileLease<Blob>>;
  toFile: (name: string, type?: string, lastModified?: number) => Promise<TemporaryFileLease<File>>;
  cleanup: () => Promise<void>;
}

type OpfsRoot = FileSystemDirectoryHandle & {
  getFileHandle: FileSystemDirectoryHandle["getFileHandle"];
};

const isValidPosition = (position: number) => Number.isSafeInteger(position) && position >= 0;

const temporaryName = (prefix: string) => {
  const identifier =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${identifier}`;
};

const makeTemporaryFileLease = <Value extends Blob>(
  value: Value,
  cleanup: () => Promise<void>,
  opfsEntryName?: string,
): TemporaryFileLease<Value> => {
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await cleanup();
  };
  return opfsEntryName ? { value, opfsEntryName, release } : { value, release };
};

const makeMemoryFileStore = (): TemporaryFileStore => {
  const patches: Array<{ position: number; data: Uint8Array }> = [];
  let currentSize = 0;
  let cleaned = false;

  const ensureActive = () => {
    if (cleaned) {
      throw new Error("temporary media storage has already been cleaned up.");
    }
  };

  const materializeBlob = (type?: string) => {
    const bytes = new Uint8Array(currentSize);
    for (const patch of patches) {
      bytes.set(patch.data, patch.position);
    }
    return new Blob([bytes], type ? { type } : undefined);
  };

  const store: TemporaryFileStore = {
    backend: "memory",
    get size() {
      return currentSize;
    },
    write: async (position, data) => {
      ensureActive();
      if (!isValidPosition(position)) {
        throw new Error("temporary media storage received an invalid write position.");
      }

      const copy = Uint8Array.from(data);
      patches.push({ position, data: copy });
      currentSize = Math.max(currentSize, position + copy.length);
    },
    append: async (data) => {
      ensureActive();
      await store.write(currentSize, data);
    },
    toBlob: async (type) => {
      ensureActive();
      return makeTemporaryFileLease(materializeBlob(type), store.cleanup);
    },
    toFile: async (name, type, lastModified = Date.now()) => {
      ensureActive();
      return makeTemporaryFileLease(
        new File([materializeBlob(type)], name, {
          type: type ?? "",
          lastModified,
        }),
        store.cleanup,
      );
    },
    cleanup: async () => {
      patches.length = 0;
      currentSize = 0;
      cleaned = true;
    },
  };

  return store;
};

const getOpfsRoot = async (): Promise<OpfsRoot | undefined> => {
  if (typeof navigator === "undefined") return undefined;

  const storage = navigator.storage;
  if (!storage || typeof storage.getDirectory !== "function") return undefined;

  try {
    return await storage.getDirectory();
  } catch {
    return undefined;
  }
};

/** Reclaims an OPFS-backed value transferred from the processing worker. */
export const adoptTemporaryFileLease = <Value extends Blob>(
  value: Value,
  opfsEntryName?: string,
): TemporaryFileLease<Value> =>
  makeTemporaryFileLease(
    value,
    async () => {
      if (!opfsEntryName) return;
      const root = await getOpfsRoot();
      await root?.removeEntry(opfsEntryName).catch(() => undefined);
    },
    opfsEntryName,
  );

const makeOpfsFileStore = async (
  root: OpfsRoot,
  prefix: string,
): Promise<TemporaryFileStore | undefined> => {
  const entryName = temporaryName(prefix);
  let handle: FileSystemFileHandle | undefined;
  let writable: FileSystemWritableFileStream | undefined;
  let currentSize = 0;
  let closed = false;
  let cleaned = false;

  try {
    handle = await root.getFileHandle(entryName, { create: true });
    writable = await handle.createWritable();
  } catch {
    if (handle) {
      await root.removeEntry(entryName).catch(() => undefined);
    }
    return undefined;
  }

  const ensureActive = () => {
    if (cleaned) {
      throw new Error("temporary media storage has already been cleaned up.");
    }
  };

  const closeWriter = async () => {
    if (closed) return;
    closed = true;
    await writable?.close();
  };

  const getBackingFile = async () => {
    await closeWriter();
    const file = await handle?.getFile();
    if (!file) throw new Error("temporary media storage file disappeared.");
    return file;
  };

  const store: TemporaryFileStore = {
    backend: "opfs",
    get size() {
      return currentSize;
    },
    write: async (position, data) => {
      ensureActive();
      if (!isValidPosition(position)) {
        throw new Error("temporary media storage received an invalid write position.");
      }
      if (closed) {
        throw new Error("temporary media storage was finalized before a write.");
      }

      // A write chunk carries its absolute offset, so LibAV can seek without
      // forcing us to keep the complete output in memory.
      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(data);
      await writable?.write({ type: "write", position, data: buffer });
      currentSize = Math.max(currentSize, position + data.byteLength);
    },
    append: async (data) => {
      ensureActive();
      await store.write(currentSize, data);
    },
    toBlob: async (type) => {
      ensureActive();
      const file = await getBackingFile();
      return makeTemporaryFileLease(
        new Blob([file], { type: type || file.type }),
        store.cleanup,
        entryName,
      );
    },
    toFile: async (name, type, lastModified = Date.now()) => {
      ensureActive();
      const file = await getBackingFile();
      return makeTemporaryFileLease(
        new File([file], name, {
          type: type || file.type,
          lastModified,
        }),
        store.cleanup,
        entryName,
      );
    },
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await closeWriter().catch(() => undefined);
      await root.removeEntry(entryName).catch(() => undefined);
    },
  };

  return store;
};

/**
 * Creates temporary media storage. OPFS is selected opportunistically; all
 * capability and quota failures use the in-memory fallback instead.
 */
export const createTemporaryFileStore = async (
  prefix = "tagium-video",
): Promise<TemporaryFileStore> => {
  const root = await getOpfsRoot();
  if (!root) return makeMemoryFileStore();

  return (await makeOpfsFileStore(root, prefix)) ?? makeMemoryFileStore();
};
