import { describe, expect, it, vi } from "vite-plus/test";
import {
  getRevocationReceipt,
  removeRevocationReceipt,
  storeRevocationReceipt,
} from "@/features/share/revocationReceipt";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("local sharing permission", () => {
  it("stores the private permission by slug and removes it after revocation", () => {
    vi.setSystemTime(new Date("2026-07-22T12:00:00Z"));
    const storage = new MemoryStorage();
    const receipt = {
      slug: "AbcdEFGHijklmno_123-45",
      expiresAt: "2026-10-20T12:00:00Z",
      token: "private-revocation-secret",
    };
    storeRevocationReceipt(receipt, storage);
    expect(getRevocationReceipt(receipt.slug, storage)).toEqual(receipt);
    removeRevocationReceipt(receipt.slug, storage);
    expect(getRevocationReceipt(receipt.slug, storage)).toBeNull();
    vi.useRealTimers();
  });

  it("silently discards expired or malformed stored permissions", () => {
    vi.setSystemTime(new Date("2026-07-22T12:00:00Z"));
    const storage = new MemoryStorage();
    storeRevocationReceipt(
      { slug: "old", expiresAt: "2026-07-21T12:00:00Z", token: "secret" },
      storage,
    );
    expect(getRevocationReceipt("old", storage)).toBeNull();
    storage.setItem("tagium.share-revocations.v1", "not json");
    expect(getRevocationReceipt("old", storage)).toBeNull();
    vi.useRealTimers();
  });
});
