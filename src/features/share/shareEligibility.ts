import type { AlbumGroup, TagiumFile } from "@/features/library/types";

const supportedSource = (value: string) => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (host === "youtu.be" ||
        host === "youtube.com" ||
        host.endsWith(".youtube.com") ||
        host === "soundcloud.com" ||
        host.endsWith(".soundcloud.com"))
    );
  } catch {
    return false;
  }
};

/** Client-side preflight mirrors the publishable parts of the manifest contract. */
export const shareEligibility = (album: AlbumGroup, files: readonly (TagiumFile | undefined)[]) => {
  if (album.trackIds.length < 1 || album.trackIds.length > 100)
    return "shared albums need between 1 and 100 tracks.";
  if (files.some((file) => !file)) return "this album has a missing track.";
  if (files.some((file) => !file?.downloadRequest))
    return "only albums made entirely from imported tracks can be shared.";
  if (files.some((file) => !file?.metadata))
    return "wait for every imported track's metadata before sharing.";
  if (files.some((file) => !supportedSource(file!.downloadRequest!.sourceUrl)))
    return "this album contains a source that tagium cannot replay.";
  if (
    album.cover?.[0] &&
    album.cover[0].format !== "image/jpeg" &&
    album.cover[0].format !== "image/png"
  )
    return "this album's cover format cannot be shared.";
  if (album.cover?.[0] && !album.cover[0].data.byteLength)
    return "this album's cover is empty and cannot be shared.";
  return null;
};
