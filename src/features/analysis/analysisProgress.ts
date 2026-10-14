/** Tooltip copy for a download that will go ahead before bpm and key detection has finished. */
export const describeProcessingTracks = (count: number) =>
  count === 1
    ? "1 track is still processing key/bpm"
    : `${count} tracks are still processing key/bpm`;

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
