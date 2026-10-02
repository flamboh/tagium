import { describe, expect, it } from "vite-plus/test";
import { makeAudioClipArgs } from "@/features/audio/audioClipWorker";

describe("audio clip worker", () => {
  it("stream copies the first audio stream between the clip bounds", () => {
    const args = makeAudioClipArgs({ kind: "m4a", start: 12.5, end: 90 });
    expect(args).toEqual(
      expect.arrayContaining(["-ss", "12.500", "-to", "90.000", "-map", "0:a:0", "-c:a", "copy"]),
    );
    expect(args.slice(-3, -1)).toEqual(["-f", "ipod"]);
  });

  it("re-encodes flac so STREAMINFO matches the clip", () => {
    const args = makeAudioClipArgs({ kind: "flac", start: 0, end: 1 });
    expect(args[args.indexOf("-c:a") + 1]).toBe("flac");
  });

  it("uses each format's native muxer", () => {
    const muxer = (kind: "mp3" | "flac" | "opus") =>
      makeAudioClipArgs({ kind, start: 0, end: 1 }).at(-2);
    expect(muxer("mp3")).toBe("mp3");
    expect(muxer("flac")).toBe("flac");
    expect(muxer("opus")).toBe("opus");
  });
});
