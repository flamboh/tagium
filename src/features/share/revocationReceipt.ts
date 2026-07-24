const STORAGE_KEY = "tagium.share-revocations.v1";

export interface LocalRevocationReceipt {
  slug: string;
  expiresAt: string;
  token: string;
}

const parseReceipts = (value: string | null): LocalRevocationReceipt[] => {
  if (!value) return [];
  try {
    const input: unknown = JSON.parse(value);
    if (!Array.isArray(input)) return [];
    return input.filter(
      (entry): entry is LocalRevocationReceipt =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.slug === "string" &&
        typeof entry.expiresAt === "string" &&
        typeof entry.token === "string",
    );
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
