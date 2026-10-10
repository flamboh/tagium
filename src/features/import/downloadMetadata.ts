import filenamify from "filenamify";
import { parseMediaLink } from "@/lib/media-link";
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
  albumArtist = artist,
  album,
  genre,
  year,
  duration,
  trackNumber,
}: {
  title: string;
  artist: string;
  albumArtist?: string;
  album: string;
  genre: string;
  year?: number;
  duration?: number;
  trackNumber?: number;
}): AudioMetadata => ({
  filename: filenameFromTitle(title).replace(/\.mp3$/i, ""),
  title,
  artist,
  albumArtist,
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

export const getPlaylistTrackPendingYear = (
  playlist: Playlist,
  track: Playlist["tracks"][number],
) => (parseMediaLink(track.url).provider === "youtube" ? undefined : playlist.year);

export const createPlaylistTrackMetadata = (
  playlist: Playlist,
  track: Playlist["tracks"][number],
) =>
  createDownloadMetadata({
    title: track.title,
    artist: track.artist ?? playlist.artist,
    albumArtist: playlist.artist,
    album: playlist.title,
    genre: playlist.genre,
    year: getPlaylistTrackPendingYear(playlist, track),
    duration: track.duration,
    trackNumber: track.trackNumber,
  });

export const createPlaylistPendingMetadataPatch = (
  playlist: Playlist,
  track: Playlist["tracks"][number],
): MetadataPatch => {
  const patch: MetadataPatch = {
    title: track.title,
    artist: track.artist ?? playlist.artist,
    albumArtist: playlist.artist,
    album: playlist.title,
    genre: playlist.genre,
  };

  const year = getPlaylistTrackPendingYear(playlist, track);

  if (year !== undefined) patch.year = year;

  if (track.trackNumber !== undefined) patch.trackNumber = track.trackNumber;

  return patch;
};
