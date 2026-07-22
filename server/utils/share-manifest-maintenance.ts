export type ShareTakedownResult = "disabled" | "not_found" | "artwork_delete_failed";

/**
 * Keeps the irreversible order explicit: availability is removed in D1 before
 * attempting R2 cleanup. Retrying after an R2 outage is safe and completes it.
 */
export const disableShareThenDeleteArtwork = async (operations: {
  disable: () => Promise<{ found: boolean; artworkKey?: string }>;
  deleteArtwork: (key: string) => Promise<void>;
}): Promise<ShareTakedownResult> => {
  const record = await operations.disable();
  if (!record.found) return "not_found";
  if (!record.artworkKey) return "disabled";
  try {
    await operations.deleteArtwork(record.artworkKey);
    return "disabled";
  } catch {
    return "artwork_delete_failed";
  }
};
