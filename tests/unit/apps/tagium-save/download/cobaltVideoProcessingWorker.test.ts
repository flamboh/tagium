import { describe, expect, it, vi } from "vite-plus/test";
import {
  createProgressSink,
  encodeWithLibAV,
  type VideoWorkerProgress,
} from "@/apps/tagium-save/download/cobaltVideoProcessingWorker";
import type { CobaltLocalProcessingPlan } from "@/apps/tagium-save/download/cobaltDownloadSchemas";

const mergePlan = (): CobaltLocalProcessingPlan => ({
  status: "local-processing",
  type: "merge",
  tunnel: ["video", "audio"],
  output: { type: "video/mp4", filename: "clip.mp4" },
});

const createLibAV = (
  runFfmpeg: (
    libav: LibAVFake,
    args: string[],
  ) => Promise<number | void> | number | void = () => {},
) => {
  const files = new Map<string, Blob>();
  const libav: LibAVFake = {
    onwrite: undefined,
    mkreadaheadfile: vi.fn(async (name, file) => {
      files.set(name, file);
    }),
    mkwriterdev: vi.fn(async () => {}),
    ffmpeg: vi.fn(async (args) => runFfmpeg(libav, args)),
    unlink: vi.fn(async (name) => {
      files.delete(name);
    }),
    unlinkreadaheadfile: vi.fn(async (name) => {
      files.delete(name);
    }),
    terminate: vi.fn(),
  };
  return { files, libav };
};

type LibAVFake = {
  onwrite?: (name: string, position: number, data: Uint8Array | Int8Array) => void;
  mkreadaheadfile: (name: string, file: Blob) => Promise<void>;
  mkwriterdev: (name: string) => Promise<void>;
  ffmpeg: (args: string[]) => Promise<number | void>;
  unlink: (name: string) => Promise<void>;
  unlinkreadaheadfile: (name: string) => Promise<void>;
  terminate: () => void;
};

describe("cobalt video processing worker", () => {
  it("parses output progress across partial writes", () => {
    const progress: VideoWorkerProgress[] = [];
    const sink = createProgressSink((value) => progress.push(value));
    const encoder = new TextEncoder();

    sink(encoder.encode("total_"));
    sink(encoder.encode("size=42\nprogress=continue\n"));
    sink(encoder.encode("progress=end\n"));

    expect(progress).toEqual([
      { bytesWritten: 42, status: "running" },
      { progress: 1, status: "complete" },
    ]);
  });

  it("writes output through the temporary store and cleans LibAV files", async () => {
    const { files, libav } = createLibAV(async (instance, args) => {
      expect(args).toContain("-map");
      expect(files.get("tagium-video-input-0")).toBeInstanceOf(File);
      instance.onwrite?.("tagium-video-output.mp4", 2, Uint8Array.of(3, 4));
      instance.onwrite?.("tagium-video-output.mp4", 0, Uint8Array.of(1, 2));
    });

    const lease = await encodeWithLibAV(
      libav,
      {
        files: [
          new File(["video"], "video.mp4", { type: "video/mp4" }),
          new File(["audio"], "audio.m4a", { type: "audio/mp4" }),
        ],
        plan: mergePlan(),
      },
      () => {},
    );

    expect(new Uint8Array(await lease.value.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3, 4));
    expect(lease.opfsEntryName).toBeUndefined();
    expect(libav.unlink).toHaveBeenCalledWith("tagium-video-output.mp4");
    expect(libav.unlink).toHaveBeenCalledWith("tagium-video-progress.txt");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-video-input-0");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-video-input-1");

    await lease.release();
    await lease.release();
  });

  it("cleans temporary files when ffmpeg fails", async () => {
    const { libav } = createLibAV(async () => {
      throw new Error("ffmpeg failed");
    });

    await expect(
      encodeWithLibAV(
        libav,
        { files: [new File(["video"], "video.mp4")], plan: mergePlan() },
        () => {},
      ),
    ).rejects.toThrow("ffmpeg failed");
    expect(libav.unlink).toHaveBeenCalledWith("tagium-video-output.mp4");
    expect(libav.unlink).toHaveBeenCalledWith("tagium-video-progress.txt");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-video-input-0");
  });

  it("rejects a nonzero ffmpeg status even when partial output was written", async () => {
    const { libav } = createLibAV((instance) => {
      instance.onwrite?.("tagium-video-output.mp4", 0, Uint8Array.of(1, 2));
      return 1;
    });

    await expect(
      encodeWithLibAV(
        libav,
        { files: [new File(["video"], "video.mp4")], plan: mergePlan() },
        () => {},
      ),
    ).rejects.toThrow("local video processing failed with status 1");
  });
});
