import { Option, Schema } from "effect";

const STORAGE_KEY = "tagium.share-revocations.v1";

export interface LocalRevocationReceipt {
  slug: string;
  expiresAt: string;
  token: string;
}

const localRevocationReceiptSchema = Schema.Struct({
  slug: Schema.String,
  expiresAt: Schema.String,
  token: Schema.String,
});
const storedReceiptListSchema = Schema.Array(Schema.Unknown);

const parseReceipts = (value: string | null): LocalRevocationReceipt[] => {
  if (!value) return [];
  try {
    const storedEntries = Schema.decodeUnknownOption(storedReceiptListSchema)(JSON.parse(value));
    if (Option.isNone(storedEntries)) return [];

    const receipts: LocalRevocationReceipt[] = [];
    for (const entry of storedEntries.value) {
      const receipt = Schema.decodeUnknownOption(localRevocationReceiptSchema)(entry);
      if (Option.isSome(receipt)) receipts.push(receipt.value);
    }
    return receipts;
  } catch {
    return [];
  }
};

const currentReceipts = (storage: Storage) =>
  parseReceipts(storage.getItem(STORAGE_KEY)).filter(
    (receipt) => Date.parse(receipt.expiresAt) > Date.now(),
  );

export const storeRevocationReceipt = (
  receipt: LocalRevocationReceipt,
  storage: Storage = localStorage,
) => {
  const receipts = currentReceipts(storage).filter((entry) => entry.slug !== receipt.slug);
  storage.setItem(STORAGE_KEY, JSON.stringify([...receipts, receipt]));
};

export const getRevocationReceipt = (
  slug: string,
  storage: Storage = localStorage,
): LocalRevocationReceipt | null =>
  currentReceipts(storage).find((receipt) => receipt.slug === slug) ?? null;

export const removeRevocationReceipt = (slug: string, storage: Storage = localStorage) => {
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify(currentReceipts(storage).filter((receipt) => receipt.slug !== slug)),
  );
};
