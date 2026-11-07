import { msg } from "gt-react";

const metadataContractError = (message: string) =>
  /manifest payload|ParseError|Expected |schema|maximumLength|too_large/i.test(message);

const userFacingMessages = new Set<string>([
  msg("the share link could not be created"),
  msg("this share contains too much metadata to publish"),
  msg("too many share requests; try again shortly"),
  msg("too many update requests; try again shortly"),
  msg("your browser did not allow tagium to save the sharing permission"),
]);

const albumMessages = new Set<string>([
  msg("the shared album could not be updated"),
  msg("this browser cannot update the shared album"),
  msg("the album is no longer in your library"),
  msg("the album has a missing track"),
]);

const trackMessages = new Set<string>([
  msg("the shared track could not be updated"),
  msg("this browser cannot update the shared track"),
  msg("the track is no longer in your library"),
]);

export class ShareIneligibleError extends Error {}

/** Converts implementation-level publish failures into copy safe for the share dialog. */
export const sharePublicationErrorMessage = (error: Error, kind: "album" | "track" = "album") => {
  if (error instanceof ShareIneligibleError) return error.message;

  if (metadataContractError(error.message))
    return kind === "album"
      ? msg("this album contains too much metadata to share.")
      : msg("this track contains too much metadata to share.");

  if (error.message === "only downloaded-source tracks with metadata can be shared") {
    return kind === "album"
      ? msg("this album contains tracks that cannot be shared.")
      : msg("this track cannot be shared.");
  }

  const message = error.message.replace(/[.!?]+$/, "");
  const targetMessages = kind === "album" ? albumMessages : trackMessages;

  return userFacingMessages.has(message) || targetMessages.has(message)
    ? message
    : msg("the share link could not be created");
};
