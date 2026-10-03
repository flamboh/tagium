import filenamify from "filenamify";
import type { Playlist } from "@/features/import/playlist";
import type { AudioMetadata, MetadataPatch } from "@/features/library/types";

const filenameFromTitle = (title: string) => {
  const filename = filenamify(title.trim(), { replacement: "-" });
  if (filename) return `${filename}.mp3`;
  return "downloading-track.mp3";
};

export const createDownloadMetadata = ({
  title,
  artist,
  album,
  genre,
  year,
  duration,
  trackNumber,
}: {
  title: string;
  artist: string;
  album: string;
  genre: string;
  year?: number;
  duration?: number;
  trackNumber?: number;
}): AudioMetadata => ({
  filename: filenameFromTitle(title).replace(/\.mp3$/i, ""),
  title,
  artist,
  albumArtist: artist,
  album,
  genre,
  duration: duration ?? 0,
  bitrate: 0,
  sampleRate: 0,
  picture: [],
  year: year ?? null,
  trackNumber: trackNumber ?? null,
  composer: "",
  comment: "",
  discNumber: null,
  bpm: null,
});

export const createPlaylistTrackMetadata = (
  playlist: Playlist,
  track: Playlist["tracks"][number],
) =>
  createDownloadMetadata({
    title: track.title,
    artist: playlist.artist,
    album: playlist.title,
    genre: playlist.genre,
    year: playlist.year,
    duration: track.duration,
    trackNumber: track.trackNumber,
  });

export const createPlaylistPendingMetadataPatch = (
  playlist: Playlist,
  track: Playlist["tracks"][number],
): MetadataPatch => {
  const patch: MetadataPatch = {
    title: track.title,
    artist: playlist.artist,
    album: playlist.title,
    genre: playlist.genre,
  };
  if (playlist.year !== undefined) patch.year = playlist.year;
  if (track.trackNumber !== undefined) patch.trackNumber = track.trackNumber;
  return patch;
};
