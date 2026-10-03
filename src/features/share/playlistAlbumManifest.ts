import {
  createPlaylistPendingMetadataPatch,
  createPlaylistTrackMetadata,
} from "@/features/import/downloadMetadata";
import type { Playlist } from "@/features/import/playlist";
import { DEFAULT_APP_SETTINGS } from "@/features/settings/settings";
import {
  projectAlbumManifest,
  type AlbumManifest,
  type ManifestAudioBitrate,
} from "@/features/share/shareManifest";

/** Projects a freshly loaded playlist exactly as the web client would share it before any edits. */
export const projectPlaylistAlbumManifest = (
  playlist: Playlist,
  audioBitrate: ManifestAudioBitrate = DEFAULT_APP_SETTINGS.audioBitrate,
): AlbumManifest =>
  projectAlbumManifest(
    playlist,
    playlist.tracks.map((track) => {
      const metadata = createPlaylistTrackMetadata(playlist, track);
      return {
        filename: `${metadata.filename}.mp3`,
        metadata,
        pendingMetadataPatch: createPlaylistPendingMetadataPatch(playlist, track),
        downloadRequest: { sourceUrl: track.url, audioBitrate },
      };
    }),
  );
