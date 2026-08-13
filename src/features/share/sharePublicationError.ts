const metadataContractError = (message: string) =>
  /manifest payload|ParseError|Expected |schema|maximumLength|too_large/i.test(message);

const userFacingMessages = new Set([
  "the share link could not be created",
  "too many share requests; try again shortly",
  "too many update requests; try again shortly",
  "your browser did not allow tagium to save the sharing permission",
]);

/** Converts implementation-level publish failures into copy safe for the share dialog. */
export const sharePublicationErrorMessage = (error: Error, kind: "album" | "track" = "album") => {
  if (metadataContractError(error.message))
    return `this ${kind} contains too much metadata to share.`;
  if (error.message === "only downloaded-source tracks with metadata can be shared") {
    return kind === "album"
      ? "this album contains tracks that cannot be shared."
      : "this track cannot be shared.";
  }
  const message = error.message.replace(/[.!?]+$/, "");
  const targetMessages = new Set([
    `the shared ${kind} could not be updated`,
    `this browser cannot update the shared ${kind}`,
    `the ${kind} is no longer in your library`,
    ...(kind === "album" ? ["the album has a missing track"] : []),
  ]);
  return userFacingMessages.has(message) || targetMessages.has(message)
    ? message
    : "the share link could not be created";
};
