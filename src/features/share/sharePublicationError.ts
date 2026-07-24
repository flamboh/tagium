const metadataContractError = (message: string) =>
  /manifest payload|ParseError|Expected |schema|maximumLength|too_large/i.test(message);

const userFacingMessages = new Set([
  "the share link could not be created",
  "the shared album could not be updated",
  "too many share requests; try again shortly",
  "too many update requests; try again shortly",
  "this browser cannot update the shared album",
  "your browser did not allow tagium to save the sharing permission",
  "the album is no longer in your library",
  "the album has a missing track",
]);

/** Converts implementation-level publish failures into copy safe for the share dialog. */
export const sharePublicationErrorMessage = (error: unknown) => {
  if (!(error instanceof Error)) return "the share link could not be created";
  if (metadataContractError(error.message))
    return "this album contains too much metadata to share.";
  if (error.message === "only downloaded-source tracks with metadata can be shared") {
    return "this album contains tracks that cannot be shared.";
  }
  const message = error.message.replace(/[.!?]+$/, "");
  return userFacingMessages.has(message) ? message : "the share link could not be created";
};
