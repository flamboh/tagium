import { describe, expect, it } from "vite-plus/test";
import { createTrackAnalysisQueue } from "@/features/analysis/trackAnalysisQueue";
import type { TrackAnalysis } from "@/features/analysis/trackAnalysis";
import {
  createLibraryState,
  libraryReducer,
  type LibraryAction,
} from "@/features/library/libraryState";
import type { AppSettings, AudioMetadata, TagiumFile } from "@/features/library/types";

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

const track = (id: string, overrides: Partial<TagiumFile> = {}): TagiumFile => ({
  id,
  file: new File(["audio"], `${id}.mp3`),
  status: "saved",
  downloadStatus: "ready",
  filename: `${id}.mp3`,
  metadata: metadata(),
  ...overrides,
});

const aMinor: TrackAnalysis = { bpm: 128, key: { pitchClass: 9, mode: "minor" } };

const setup = (
  files: TagiumFile[],
  initialSettings: Pick<AppSettings, "djAnalysis" | "keyNotation"> = {
    djAnalysis: true,
    keyNotation: "standard",
  },
) => {
  let state = { ...createLibraryState(), files };
  let settings = initialSettings;
  let exportRunning = false;
  const analyzed: string[] = [];
  const aborted: string[] = [];
  const pendingHistory: string[][] = [];
  const resolvers = new Map<string, (analysis: TrackAnalysis) => void>();
  const rejecters = new Map<string, (error: Error) => void>();

  const queue = createTrackAnalysisQueue({
    library: {
      getSnapshot: () => state,
      dispatch: (action: LibraryAction) => {
        state = libraryReducer(state, action);
      },
    },
    getSettings: () => settings,
    isExportRunning: () => exportRunning,
    analyze: (file, _duration, signal) =>
      new Promise((resolve, reject) => {
        const id = file.name.replace(/\.mp3$/u, "");
        analyzed.push(id);
        resolvers.set(id, resolve);
        rejecters.set(id, reject);
        signal.addEventListener("abort", () => {
          aborted.push(id);
          reject(new Error("interrupted"));
        });
      }),
    onPendingChange: (trackIds) => pendingHistory.push([...trackIds]),
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  return {
    queue,
    analyzed,
    aborted,
    pendingHistory,
    getFile: (id: string) => state.files.find((file) => file.id === id)!,
    setFiles: (next: TagiumFile[]) => {
      state = { ...state, files: next };
    },
    setSettings: (next: typeof settings) => {
      settings = next;
    },
    setExportRunning: (running: boolean) => {
      exportRunning = running;
    },
    resolve: async (id: string, analysis: TrackAnalysis) => {
      resolvers.get(id)!(analysis);
      await settle();
    },
    reject: async (id: string) => {
      rejecters.get(id)!(new Error("decode failed"));
      await settle();
    },
  };
};

describe("track analysis queue", () => {
  it("analyzes tracks one at a time and fills their empty tempo and key", async () => {
    const harness = setup([track("one"), track("two")]);
    harness.queue.sync();
    expect(harness.analyzed).toEqual(["one"]);
    expect(harness.pendingHistory.at(-1)).toEqual(["one", "two"]);

    await harness.resolve("one", aMinor);
    expect(harness.getFile("one")).toMatchObject({
      status: "pending",
      metadata: { bpm: 128, musicalKey: "Am" },
      pendingMetadataPatch: { bpm: 128, musicalKey: "Am" },
    });
    expect(harness.analyzed).toEqual(["one", "two"]);
    expect(harness.pendingHistory.at(-1)).toEqual(["two"]);

    await harness.resolve("two", { bpm: 174, key: null });
    expect(harness.getFile("two").metadata).toMatchObject({ bpm: 174, musicalKey: "" });
    expect(harness.pendingHistory.at(-1)).toEqual([]);
  });

  it("writes camelot codes when that notation is selected", async () => {
    const harness = setup([track("one")], { djAnalysis: true, keyNotation: "camelot" });
    harness.queue.sync();
    await harness.resolve("one", aMinor);
    expect(harness.getFile("one").metadata?.musicalKey).toBe("8A");
  });

  it("never replaces a value that is already on the track", async () => {
    const harness = setup([
      track("one", { metadata: metadata({ bpm: 90 }) }),
      track("tagged", { metadata: metadata({ bpm: 120, musicalKey: "C" }) }),
    ]);

    harness.queue.sync();
    expect(harness.analyzed).toEqual(["one"]);

    await harness.resolve("one", aMinor);
    expect(harness.getFile("one").metadata).toMatchObject({ bpm: 90, musicalKey: "Am" });
    expect(harness.getFile("one").pendingMetadataPatch).toEqual({ musicalKey: "Am" });
    expect(harness.analyzed).toEqual(["one"]);
  });

  it("keeps a value typed while the analysis was running", async () => {
    const harness = setup([track("one")]);
    harness.queue.sync();
    harness.setFiles([track("one", { metadata: metadata({ bpm: 64 }) })]);
    await harness.resolve("one", aMinor);
    expect(harness.getFile("one").metadata).toMatchObject({ bpm: 64, musicalKey: "Am" });
  });

  it("skips mixes, tracks without audio, and failed tracks", () => {
    const harness = setup([
      track("mix", { metadata: metadata({ duration: 15 * 60 + 1 }) }),
      track("downloading", { file: undefined, downloadStatus: "downloading" }),
      track("broken", { status: "error" }),
    ]);

    harness.queue.sync();
    expect(harness.analyzed).toEqual([]);
  });

  it("analyzes a track once its download finishes", () => {
    const harness = setup([track("one", { file: undefined, downloadStatus: "downloading" })]);
    harness.queue.sync();
    expect(harness.analyzed).toEqual([]);

    harness.setFiles([track("one")]);
    harness.queue.sync();
    expect(harness.analyzed).toEqual(["one"]);
  });

  it("does not analyze a track twice, even after a failure or a cleared value", async () => {
    const harness = setup([track("one"), track("two")]);
    harness.queue.sync();
    await harness.reject("one");
    expect(harness.getFile("one").metadata).toMatchObject({ bpm: null, musicalKey: "" });
    await harness.resolve("two", aMinor);

    harness.setFiles([track("one"), track("two")]);
    harness.queue.sync();
    expect(harness.analyzed).toEqual(["one", "two"]);
  });

  it("does nothing while the setting is off and interrupts the running analysis when it turns off", async () => {
    const harness = setup([track("one"), track("two")], {
      djAnalysis: false,
      keyNotation: "standard",
    });

    harness.queue.sync();
    expect(harness.analyzed).toEqual([]);

    harness.setSettings({ djAnalysis: true, keyNotation: "standard" });
    harness.queue.sync();
    expect(harness.analyzed).toEqual(["one"]);

    harness.setSettings({ djAnalysis: false, keyNotation: "standard" });
    harness.queue.sync();
    expect(harness.aborted).toEqual(["one"]);
    expect(harness.pendingHistory.at(-1)).toEqual([]);

    // a result that lands after the abort is discarded
    await harness.resolve("one", aMinor);
    expect(harness.getFile("one").metadata).toMatchObject({ bpm: null, musicalKey: "" });
  });

  it("analyzes again, and only applies the new run, when the setting is turned off and back on", async () => {
    const harness = setup([track("one")]);
    harness.queue.sync();
    harness.setSettings({ djAnalysis: false, keyNotation: "standard" });
    harness.queue.sync();
    harness.setSettings({ djAnalysis: true, keyNotation: "standard" });
    harness.queue.sync();
    expect(harness.aborted).toEqual(["one"]);
    expect(harness.analyzed).toEqual(["one", "one"]);
    expect(harness.pendingHistory.at(-1)).toEqual(["one"]);

    await harness.resolve("one", aMinor);
    expect(harness.getFile("one").metadata).toMatchObject({ bpm: 128, musicalKey: "Am" });
    expect(harness.pendingHistory.at(-1)).toEqual([]);
  });

  it("interrupts the analysis of a track that is removed", async () => {
    const harness = setup([track("one"), track("two")]);
    harness.queue.sync();
    harness.setFiles([track("two")]);
    harness.queue.sync();
    expect(harness.aborted).toEqual(["one"]);
    expect(harness.analyzed).toEqual(["one", "two"]);
    expect(harness.pendingHistory.at(-1)).toEqual(["two"]);
  });

  it("holds results that land during an export and applies them when it finishes", async () => {
    const harness = setup([track("one")]);
    harness.queue.sync();
    harness.setExportRunning(true);
    await harness.resolve("one", aMinor);
    expect(harness.getFile("one").metadata).toMatchObject({ bpm: null, musicalKey: "" });
    expect(harness.pendingHistory.at(-1)).toEqual(["one"]);

    harness.queue.sync();
    expect(harness.getFile("one").metadata).toMatchObject({ bpm: null, musicalKey: "" });

    harness.setExportRunning(false);
    harness.queue.sync();
    expect(harness.getFile("one").metadata).toMatchObject({ bpm: 128, musicalKey: "Am" });
    expect(harness.pendingHistory.at(-1)).toEqual([]);
  });

  it("drops held results when the setting is turned off", async () => {
    const harness = setup([track("one")]);
    harness.queue.sync();
    harness.setExportRunning(true);
    await harness.resolve("one", aMinor);
    harness.setSettings({ djAnalysis: false, keyNotation: "standard" });
    harness.setExportRunning(false);
    harness.queue.sync();
    expect(harness.getFile("one").metadata).toMatchObject({ bpm: null, musicalKey: "" });
    expect(harness.pendingHistory.at(-1)).toEqual([]);
  });

  it("forgets removed tracks and stops after disposal", async () => {
    const harness = setup([track("one"), track("two")]);
    harness.queue.sync();
    harness.setFiles([track("one")]);
    harness.queue.sync();
    expect(harness.pendingHistory.at(-1)).toEqual(["one"]);

    harness.queue.dispose();
    expect(harness.aborted).toEqual(["one"]);
    await harness.resolve("one", aMinor);
    expect(harness.getFile("one").metadata).toMatchObject({ bpm: null, musicalKey: "" });
    expect(harness.analyzed).toEqual(["one"]);
  });
});
