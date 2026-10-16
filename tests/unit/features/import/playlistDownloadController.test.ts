import { describe, expect, it, vi } from "vite-plus/test";
import { Effect } from "effect";
import {
  createPlaylistDownloadController,
  type PlaylistDownloadControllerSnapshot,
} from "@/features/import/playlistDownloadController";

type Track = { fileId: string; title: string; sourceUrl: string };

const soundCloudTrack = (index: number): Track => ({
  fileId: `soundcloud-${index}`,
  title: `soundcloud ${index}`,
  sourceUrl: `https://soundcloud.com/artist/track-${index}`,
});

const youtubeTrack = (index: number): Track => ({
  fileId: `youtube-${index}`,
  title: `youtube ${index}`,
  sourceUrl: `https://www.youtube.com/watch?v=video${String(index).padStart(6, "0")}`,
});

const createHarness = () => {
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  let snapshot: PlaylistDownloadControllerSnapshot | null = null;

  const controller = createPlaylistDownloadController<Track>({
    createModelTrack: (track) => ({
      id: track.fileId,
      title: track.title,
      sourceUrl: track.sourceUrl,
    }),
    downloadTrack: (track) =>
      Effect.promise(
        () =>
          new Promise<File>((resolve) => {
            started.push(track.fileId);
            releases.set(track.fileId, () => resolve(new File([], `${track.title}.mp3`)));
          }),
      ),
    hydrateTrack: () => Effect.void,
    hasTrack: () => true,
    getFileErrorTrackIds: () => new Set(),
    markQueued: vi.fn(),
    markCanceled: vi.fn(),
    markFailed: vi.fn(),
    emitSnapshot: (next) => {
      snapshot = next;
    },
  });

  return {
    controller,
    started,
    release: (fileId: string) => releases.get(fileId)!(),
    snapshot: () => snapshot,
  };
};

describe("playlist download concurrency", () => {
  it("downloads six soundcloud tracks at a time", async () => {
    const harness = createHarness();
    const tracks = Array.from({ length: 8 }, (_, index) => soundCloudTrack(index + 1));

    harness.controller.enqueue(tracks);

    await vi.waitFor(() => expect(harness.started).toHaveLength(6));
    expect(harness.snapshot()?.active).toHaveLength(6);
    expect(harness.snapshot()?.pending).toBe(2);

    harness.release("soundcloud-1");
    await vi.waitFor(() => expect(harness.started).toHaveLength(7));
    expect(harness.started.at(-1)).toBe("soundcloud-7");
  });

  it("keeps youtube playlists at three downloads at a time", async () => {
    const harness = createHarness();
    const tracks = Array.from({ length: 5 }, (_, index) => youtubeTrack(index + 1));

    harness.controller.enqueue(tracks);

    await vi.waitFor(() => expect(harness.started).toHaveLength(3));
    expect(harness.snapshot()?.pending).toBe(2);

    harness.release("youtube-1");
    await vi.waitFor(() => expect(harness.started).toHaveLength(4));
  });

  it("starts youtube tracks in a mixed queue only while fewer than three downloads run", async () => {
    const harness = createHarness();

    harness.controller.enqueue([
      soundCloudTrack(1),
      soundCloudTrack(2),
      soundCloudTrack(3),
      soundCloudTrack(4),
      youtubeTrack(1),
      soundCloudTrack(5),
    ]);

    await vi.waitFor(() => expect(harness.started).toHaveLength(4));
    expect(harness.snapshot()?.pending).toBe(2);

    harness.release("soundcloud-1");
    await vi.waitFor(() => expect(harness.snapshot()?.active).toHaveLength(3));
    expect(harness.started).toHaveLength(4);

    harness.release("soundcloud-2");
    await vi.waitFor(() => expect(harness.started).toHaveLength(6));
    expect(harness.started.slice(4)).toEqual(["youtube-1", "soundcloud-5"]);
  });
});
