import { describe, expect, it } from "vite-plus/test";
import { createPlaylistDownloadPlan } from "@/features/import/downloadTrack";
import type { Playlist } from "@/features/import/playlist";
import { projectPlaylistAlbumManifest } from "@/features/share/playlistAlbumManifest";
import { projectAlbumManifest } from "@/features/share/shareManifest";

const playlist: Playlist = {
  title: "Imaginal Disk",
  artist: "Magdalena Bay",
  genre: "Pop",
  year: 2024,
  isAlbum: true,
  sourceUrl: "https://music.youtube.com/playlist?list=OLAK5uy_album",
  tracks: [
    {
      title: "She Looked Like Me!",
      url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      trackNumber: 1,
    },
    {
      title: "Killing Time / Reprise",
      url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
      trackNumber: 3,
    },
  ],
};

describe("playlist album manifest", () => {
  it("matches what the web client shares for a freshly loaded playlist", () => {
    let id = 0;
    const plan = createPlaylistDownloadPlan({
      playlist,
      audioBitrate: "320",
      audioFormat: "mp3",
      createId: () => `id-${id++}`,
    });

    expect(projectPlaylistAlbumManifest(playlist)).toEqual(
      projectAlbumManifest(plan.album, plan.pendingFiles),
    );
  });

  it("uses the default bitrate, sanitized filenames, provider track numbers, and canonical provenance", () => {
    const manifest = projectPlaylistAlbumManifest(playlist);

    expect(manifest.album).toEqual({
      title: "Imaginal Disk",
      artist: "Magdalena Bay",
      genre: "Pop",
      year: 2024,
      sourceUrl: "https://www.youtube.com/playlist?list=OLAK5uy_album",
    });
    expect(manifest.tracks).toEqual([
      {
        sourceUrl: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
        audioBitrate: "320",
        metadata: {
          filename: "She Looked Like Me!",
          title: "She Looked Like Me!",
          artist: "Magdalena Bay",
          album: "Imaginal Disk",
          genre: "Pop",
          year: 2024,
          trackNumber: 1,
        },
      },
      {
        sourceUrl: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
        audioBitrate: "320",
        metadata: {
          filename: "Killing Time - Reprise",
          title: "Killing Time / Reprise",
          artist: "Magdalena Bay",
          album: "Imaginal Disk",
          genre: "Pop",
          year: 2024,
          trackNumber: 3,
        },
      },
    ]);
  });
});
