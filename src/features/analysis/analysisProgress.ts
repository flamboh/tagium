export const countProcessingTracks = (
  trackIds: Iterable<string>,
  pendingTrackIds: ReadonlySet<string>,
) => {
  let count = 0;

  for (const trackId of trackIds) {
    if (pendingTrackIds.has(trackId)) count += 1;
  }

  return count;
};
