const metadataContractError = (message: string) =>
  /manifest payload|ParseError|Expected |schema|maximumLength|too_large/i.test(message);

/** Converts implementation-level publish failures into copy safe for the share dialog. */
export const sharePublicationErrorMessage = (error: unknown) => {
  if (!(error instanceof Error)) return "the share link could not be created";
  if (metadataContractError(error.message))
    return "This album contains too much metadata to share.";
  if (error.message === "only downloaded-source tracks with metadata can be shared") {
    return "This album contains tracks that cannot be shared.";
  }
  return error.message;
};
