import type { AlbumGroup, TagiumFile } from "@/features/library/types";
import { msg } from "gt-react";
import { parseMediaLink } from "@/lib/media-link";

const supportedSource = (value: string) => {
  try {
    return parseMediaLink(value).kind !== "unsupported";
  } catch {
    return false;
  }
};

const downloadFailed = (file: TagiumFile) =>
  file.downloadStatus === "error" || file.downloadStatus === "canceled";

/** Client-side preflight mirrors the publishable parts of the manifest contract. */
export const shareEligibility = (album: AlbumGroup, files: readonly (TagiumFile | undefined)[]) => {
  if (album.sourceManifestSlug) return msg("shared albums cannot be shared again");

  if (files.some((file) => file?.sourceManifestSlug))
    return msg("albums containing tracks added from share links cannot be shared");

  if (album.trackIds.length < 1 || album.trackIds.length > 100)
    return msg("shared albums need between 1 and 100 tracks.");

  if (files.some((file) => !file)) return msg("this album has a missing track.");

  if (files.some((file) => !file?.downloadRequest))
    return msg("only albums made entirely from imported tracks can be shared.");
  const downloading = files.filter((file) => file?.downloadStatus === "downloading").length;

  if (downloading > 0)
    return msg(
      "{downloading, plural, one {{downloading} of {total} tracks is still downloading} other {{downloading} of {total} tracks are still downloading}}",
      { downloading, total: files.length },
    );
  const failed = files.filter((file) => file && downloadFailed(file)).length;

  if (failed > 0)
    return failed === 1
      ? msg("retry or remove the failed track to share this album")
      : msg("retry or remove {failed} failed tracks to share this album", { failed });

  if (album.coverPending) return msg("the album cover is still loading");

  if (files.some((file) => !file?.metadata))
    return msg("wait for every imported track's metadata before sharing.");

  if (files.some((file) => !supportedSource(file!.downloadRequest!.sourceUrl)))
    return msg("this album contains a source that tagium cannot replay.");

  if (
    album.cover?.[0] &&
    album.cover[0].format !== "image/jpeg" &&
    album.cover[0].format !== "image/png"
  )
    return msg("this album's cover format cannot be shared.");

  if (album.cover?.[0] && !album.cover[0].data.byteLength)
    return msg("this album's cover is empty and cannot be shared.");

  return null;
};

/** Client-side preflight for a single replayable track publication. */
export const shareTrackEligibility = (file: TagiumFile) => {
  if (file.sourceManifestSlug) return msg("tracks added from share links cannot be shared again");

  if (!file.downloadRequest) return msg("local tracks cannot be shared");

  if (file.downloadStatus === "downloading") return msg("this track is still downloading");

  if (downloadFailed(file)) return msg("retry this track's download to share it");

  if (!file.metadata) return msg("wait for this track's metadata before sharing");

  if (!supportedSource(file.downloadRequest.sourceUrl))
    return msg("tagium cannot replay this track's source");
  const effectivePicture = file.pendingMetadataPatch?.picture ?? file.metadata.picture;

  if (
    effectivePicture?.[0] &&
    effectivePicture[0].format !== "image/jpeg" &&
    effectivePicture[0].format !== "image/png"
  )
    return msg("this track's artwork format cannot be shared");

  if (effectivePicture?.[0] && !effectivePicture[0].data.byteLength)
    return msg("this track's artwork is empty and cannot be shared");

  return null;
};
