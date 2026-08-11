import type { AlbumGroup, TagiumFile } from "@/features/library/types";
import { parseMediaLink } from "@/lib/media-link";

const supportedSource = (value: string) => {
  try {
    return parseMediaLink(value).kind !== "unsupported";
  } catch {
    return false;
  }
};

/** Client-side preflight mirrors the publishable parts of the manifest contract. */
export const shareEligibility = (album: AlbumGroup, files: readonly (TagiumFile | undefined)[]) => {
  if (album.sourceManifestSlug) return "shared albums cannot be shared again";
  if (files.some((file) => file?.sourceManifestSlug))
    return "albums containing tracks added from share links cannot be shared";
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

/** Client-side preflight for a single replayable track publication. */
export const shareTrackEligibility = (file: TagiumFile) => {
  if (file.sourceManifestSlug) return "tracks added from share links cannot be shared again";
  if (!file.downloadRequest) return "local tracks cannot be shared";
  if (!file.metadata) return "wait for this track's metadata before sharing";
  if (!supportedSource(file.downloadRequest.sourceUrl))
    return "tagium cannot replay this track's source";
  const effectivePicture = file.pendingMetadataPatch?.picture ?? file.metadata.picture;
  if (
    effectivePicture?.[0] &&
    effectivePicture[0].format !== "image/jpeg" &&
    effectivePicture[0].format !== "image/png"
  )
    return "this track's artwork format cannot be shared";
  if (effectivePicture?.[0] && !effectivePicture[0].data.byteLength)
    return "this track's artwork is empty and cannot be shared";
  return null;
};
