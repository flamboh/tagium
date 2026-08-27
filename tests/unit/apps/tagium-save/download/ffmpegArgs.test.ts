import { describe, expect, it } from "vite-plus/test";
import {
  makeLocalProcessingFfmpegArgs,
  makeMetadataFfmpegArgs,
} from "@/apps/tagium-save/download/ffmpegArgs";
import type { CobaltLocalProcessingPlan } from "@/apps/tagium-save/download/cobaltDownloadSchemas";

const plan = (overrides: Partial<CobaltLocalProcessingPlan> = {}): CobaltLocalProcessingPlan => ({
  status: "local-processing",
  type: "merge",
  tunnel: ["video", "audio"],
  output: { type: "video/mp4", filename: "clip.mp4" },
  ...overrides,
});

describe("cobalt video ffmpeg args", () => {
  it("merges separate video and audio tunnels with stream copies", () => {
    expect(makeLocalProcessingFfmpegArgs(plan(), ["input-0", "input-1"], "output.mp4")).toEqual([
      "-nostdin",
      "-y",
      "-loglevel",
      "error",
      "-progress",
      "tagium-video-progress.txt",
      "-i",
      "input-0",
      "-i",
      "input-1",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-movflags",
      "faststart+frag_keyframe+empty_moov",
      "-c:a",
      "copy",
      "-f",
      "mp4",
      "output.mp4",
    ]);
  });

  it("mutes video without re-encoding the video stream", () => {
    expect(
      makeLocalProcessingFfmpegArgs(
        plan({
          type: "mute",
          tunnel: ["video"],
          output: { type: "video/webm", filename: "clip.webm" },
        }),
        ["input-0"],
        "output.webm",
      ),
    ).toContainEqual("-an");
    expect(
      makeLocalProcessingFfmpegArgs(
        plan({
          type: "mute",
          tunnel: ["video"],
          output: { type: "video/webm", filename: "clip.webm" },
        }),
        ["input-0"],
        "output.webm",
      ),
    ).toEqual([
      "-nostdin",
      "-y",
      "-loglevel",
      "error",
      "-progress",
      "tagium-video-progress.txt",
      "-i",
      "input-0",
      "-map",
      "0:v:0",
      "-c:v",
      "copy",
      "-an",
      "-f",
      "webm",
      "output.webm",
    ]);
  });

  it("includes requested subtitles in muted video output", () => {
    const args = makeLocalProcessingFfmpegArgs(
      plan({
        type: "mute",
        tunnel: ["video", "subtitles"],
        output: {
          type: "video/mp4",
          filename: "clip.mp4",
          subtitles: true,
          metadata: { sublanguage: "eng" },
        },
      }),
      ["input-0", "input-1"],
      "output.mp4",
    );

    expect(args).toContainEqual("-an");
    expect(args).toContainEqual("1:s:0");
    expect(args).toContainEqual("mov_text");
    expect(args).toContainEqual("language=eng");
  });

  it("uses ffmpeg's matroska muxer for mkv output", () => {
    const args = makeLocalProcessingFfmpegArgs(
      plan({ output: { type: "video/x-matroska", filename: "clip.mkv" } }),
      ["input-0", "input-1"],
      "output.mkv",
    );

    expect(args.slice(-3)).toEqual(["-f", "matroska", "output.mkv"]);
  });

  it("handles audio, gif, and metadata without allowing arbitrary ffmpeg flags", () => {
    expect(
      makeLocalProcessingFfmpegArgs(
        plan({
          type: "audio",
          tunnel: ["audio"],
          output: {
            type: "audio/mpeg",
            filename: "clip.mp3",
            metadata: { title: "Ti\u0007tle\n", ignored: "-filter_complex evil" },
          },
          audio: { copy: false, format: "mp3", bitrate: "128" },
        }),
        ["input-0"],
        "output.mp3",
      ),
    ).toContainEqual("title=Title");

    expect(
      makeLocalProcessingFfmpegArgs(
        plan({
          type: "gif",
          tunnel: ["video"],
          output: { type: "image/gif", filename: "clip.gif" },
        }),
        ["input-0"],
        "output.gif",
      ),
    ).toContainEqual("scale=-1:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse");
    expect(makeMetadataFfmpegArgs({ ignored: "value", artist: "artist" })).toEqual([
      "-metadata",
      "artist=artist",
    ]);
  });
});
