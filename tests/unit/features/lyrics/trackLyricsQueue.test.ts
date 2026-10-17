import { describe, expect, it } from "vite-plus/test";
import {
  createLibraryState,
  libraryReducer,
  type LibraryAction,
} from "@/features/library/libraryState";
import type { AudioMetadata, TagiumFile } from "@/features/library/types";
import {
  getLyricsQuery,
  type LyricsLookup,
  type LyricsLookupProgress,
} from "@/features/lyrics/lyricsLookup";
import {
  createTrackLyricsQueue,
  getLyricsLookupStatus,
  type LyricsLookupStatus,
} from "@/features/lyrics/useTrackLyrics";

const metadata = (overrides: Partial<AudioMetadata> = {}): AudioMetadata => ({
  filename: "track",
  title: "Track",
  artist: "Artist",
  albumArtist: "",
  album: "",
  year: null,
  genre: "",
  duration: 240,
  bitrate: 320_000,
  sampleRate: 44_100,
  picture: [],
  trackNumber: null,
  composer: "",
  comment: "",
  discNumber: null,
  bpm: null,
  musicalKey: "",
  lyrics: "",
  ...overrides,
});

const track = (id: string, overrides: Partial<AudioMetadata> = {}): TagiumFile => ({
  id,
  status: "saved",
  downloadStatus: "ready",
  filename: `${id}.mp3`,
  metadata: metadata({ title: id, ...overrides }),
});

const setup = (files: TagiumFile[]) => {
  let state = { ...createLibraryState(), files };
  let unsaved: TagiumFile[] | null = null;
  let findLyrics = true;
  const looked: string[] = [];
  const resolvers = new Map<string, (lookup: LyricsLookup) => void>();
  const rejecters = new Map<string, (error: Error) => void>();
  const progress = new Map<string, LyricsLookupProgress>();
  let pending: ReadonlySet<string> = new Set();
  const statuses = new Map<string, LyricsLookupStatus>();

  const queue = createTrackLyricsQueue({
    library: {
      getSnapshot: () => state,
      dispatch: (action: LibraryAction) => {
        state = libraryReducer(state, action);
      },
    },
    getCurrentFiles: () => unsaved ?? state.files,
    getSettings: () => ({ findLyrics }),
    isExportRunning: () => false,
    lookup: (trackMetadata, _signal, lookupProgress) =>
      new Promise((resolve, reject) => {
        looked.push(trackMetadata.title);
        resolvers.set(trackMetadata.title, resolve);
        rejecters.set(trackMetadata.title, reject);
        progress.set(trackMetadata.title, lookupProgress);
        lookupProgress.onSearching();
      }),
    onPendingChange: (trackIds) => {
      pending = trackIds;
    },
    onStatusChange: (trackId, status) => {
      if (status === undefined) statuses.delete(trackId);
      else statuses.set(trackId, status);
    },
  });

  return {
    queue,
    looked,
    getFile: (id: string) => state.files.find((file) => file.id === id)!,
    setFiles: (next: TagiumFile[]) => {
      state = { ...state, files: next };
    },
    setUnsaved: (next: TagiumFile[] | null) => {
      unsaved = next;
    },
    setFindLyrics: (next: boolean) => {
      findLyrics = next;
    },
    resolve: async (id: string, lookup: LyricsLookup) => {
      resolvers.get(id)!(lookup);
      await new Promise((settle) => setTimeout(settle, 0));
    },
    fail: async (id: string) => {
      rejecters.get(id)!(new Error("lyrics.upstream_failed"));
      await new Promise((settle) => setTimeout(settle, 0));
    },
    busy: (id: string) => progress.get(id)!.onBusy(),
    status: (id: string) => getLyricsLookupStatus(id, pending, statuses),
  };
};

describe("track lyrics queue", () => {
  it("fills empty lyrics one track at a time and marks them for export", async () => {
    const harness = setup([track("one"), track("two")]);
    harness.queue.sync();
    expect(harness.looked).toEqual(["one"]);

    await harness.resolve("one", { status: "found", lyrics: "[00:01.00] hi", synced: true });
    expect(harness.getFile("one")).toMatchObject({
      status: "pending",
      metadata: { lyrics: "[00:01.00] hi" },
      pendingMetadataPatch: { lyrics: "[00:01.00] hi" },
    });
    expect(harness.looked).toEqual(["one", "two"]);

    await harness.resolve("two", { status: "instrumental" });
    expect(harness.getFile("two")).toMatchObject({ status: "saved", metadata: { lyrics: "" } });

    harness.queue.sync();
    expect(harness.looked).toEqual(["one", "two"]);
  });

  it("reports each track's lookup state and retries a failed lookup on request", async () => {
    const harness = setup([track("one"), track("two"), track("three")]);
    harness.queue.sync();
    expect(["one", "two", "three"].map(harness.status)).toEqual(["searching", "queued", "queued"]);

    harness.busy("one");
    expect(harness.status("one")).toBe("busy");

    await harness.resolve("one", { status: "missing" });
    await harness.resolve("two", { status: "instrumental" });
    await harness.fail("three");
    expect(["one", "two", "three"].map(harness.status)).toEqual([
      "missing",
      "instrumental",
      "failed",
    ]);

    harness.queue.retry("three");
    expect(harness.looked).toEqual(["one", "two", "three", "three"]);
    await harness.resolve("three", { status: "found", lyrics: "found", synced: false });
    expect(harness.status("three")).toBeUndefined();
    expect(harness.getFile("three").metadata?.lyrics).toBe("found");
  });

  it("skips tracks that already have lyrics or no artist to search by", () => {
    const harness = setup([
      track("tagged", { lyrics: "mine" }),
      track("anonymous", { artist: " " }),
    ]);

    harness.queue.sync();
    expect(harness.looked).toEqual([]);
  });

  it("keeps lyrics typed while the lookup was running", async () => {
    const harness = setup([track("one")]);
    harness.queue.sync();
    harness.setFiles([
      { ...harness.getFile("one"), metadata: metadata({ title: "one", lyrics: "typed" }) },
    ]);

    await harness.resolve("one", { status: "found", lyrics: "found", synced: false });
    expect(harness.getFile("one").metadata?.lyrics).toBe("typed");
  });

  it("drops lyrics for a title that changed mid lookup and looks up the new one", async () => {
    const harness = setup([track("old song")]);
    harness.queue.sync();
    harness.setFiles([
      { ...harness.getFile("old song"), metadata: metadata({ title: "new song" }) },
    ]);
    harness.queue.sync();
    expect(harness.looked).toEqual(["old song", "new song"]);

    await harness.resolve("old song", { status: "found", lyrics: "old lyrics", synced: false });
    expect(harness.getFile("old song").metadata?.lyrics).toBe("");

    await harness.resolve("new song", { status: "found", lyrics: "new lyrics", synced: false });
    expect(harness.getFile("old song").metadata?.lyrics).toBe("new lyrics");
  });

  it("drops lyrics for a title edited in the editor but not yet saved", async () => {
    const harness = setup([track("old song")]);
    harness.queue.sync();
    harness.setUnsaved([
      { ...harness.getFile("old song"), metadata: metadata({ title: "new song" }) },
    ]);

    await harness.resolve("old song", { status: "found", lyrics: "old lyrics", synced: false });
    expect(harness.getFile("old song").metadata?.lyrics).toBe("");
  });

  it("looks a track up once its missing artist is filled in", () => {
    const harness = setup([track("one", { artist: "" })]);
    harness.queue.sync();
    expect(harness.looked).toEqual([]);

    harness.setFiles([{ ...harness.getFile("one"), metadata: metadata({ title: "one" }) }]);
    harness.queue.sync();
    expect(harness.looked).toEqual(["one"]);
  });

  it("waits for the setting before looking anything up", () => {
    const harness = setup([track("one")]);
    harness.setFindLyrics(false);
    harness.queue.sync();
    expect(harness.looked).toEqual([]);

    harness.setFindLyrics(true);
    harness.queue.sync();
    expect(harness.looked).toEqual(["one"]);
  });
});

describe("lyrics query", () => {
  it("searches by the cleaned up title and leaves out an empty or single's album", () => {
    expect(
      getLyricsQuery({
        title: "Artist - Song (Official Audio)",
        artist: "Artist",
        album: "",
        duration: 200,
      }),
    ).toEqual({ title: "Song", artist: "Artist", duration: 200 });

    expect(
      getLyricsQuery({ title: " Song ", artist: "Artist", album: "Record", duration: 200 }),
    ).toEqual({ title: "Song", artist: "Artist", album: "Record", duration: 200 });

    expect(
      getLyricsQuery({ title: "Song", artist: "Artist", album: "song", duration: 200 }),
    ).toEqual({ title: "Song", artist: "Artist", duration: 200 });
  });
});
