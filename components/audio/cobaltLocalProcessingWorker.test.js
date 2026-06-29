import { describe, expect, it, vi } from "vite-plus/test";
import {
  createOutputSink,
  createProgressSink,
  encodeWithLibAV,
} from "./cobaltLocalProcessingWorker.js";

const createRequest = () => ({
  files: [
    new File(["audio"], "audio.wav", { type: "audio/wav" }),
    new File(["cover"], "cover.jpg", { type: "image/jpeg" }),
  ],
  args: ["-codec:a", "libmp3lame", "-b:a", "128k"],
  output: {
    format: "mp3",
    type: "audio/mpeg",
  },
});

const createLibav = (runFfmpeg = async () => {}) => {
  const files = new Map();
  const libav = {
    mkreadaheadfile: vi.fn(async (name, file) => {
      files.set(name, file);
    }),
    mkwriterdev: vi.fn(async () => {}),
    ffmpeg: vi.fn(async (args) => {
      await runFfmpeg(libav, args);
    }),
    unlink: vi.fn(async (name) => {
      files.delete(name);
    }),
    unlinkreadaheadfile: vi.fn(async (name) => {
      files.delete(name);
    }),
    writeFile: vi.fn(async () => {
      throw new Error("writeFile should not be used");
    }),
    readFile: vi.fn(async () => {
      throw new Error("readFile should not be used");
    }),
  };

  return { files, libav };
};

describe("cobalt local processing worker", () => {
  it("parses progress writes across chunk boundaries", () => {
    const encoder = new TextEncoder();
    const progress = [];
    const sink = createProgressSink((value) => {
      progress.push(value);
    });

    sink(encoder.encode("frame=1\ntotal_"));
    sink(encoder.encode("size=321\nspeed=1x\ntotal_size=invalid\n"));

    expect(progress).toEqual([321, undefined]);
  });

  it("registers inputs, runs ffmpeg, returns the output blob, and cleans up", async () => {
    const request = createRequest();
    const progress = [];
    const arrayBuffers = request.files.map((file) => vi.spyOn(file, "arrayBuffer"));
    const { files, libav } = createLibav(async (instance, args) => {
      expect(args).toEqual([
        "-nostdin",
        "-y",
        "-loglevel",
        "error",
        "-progress",
        "tagium-progress.txt",
        "-i",
        "tagium-input-0",
        "-i",
        "tagium-input-1",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "tagium-output.mp3",
      ]);

      expect(files.get("tagium-input-0")).toBe(request.files[0]);
      expect(files.get("tagium-input-1")).toBe(request.files[1]);

      instance.onwrite?.("tagium-progress.txt", 0, new TextEncoder().encode("total_size=5\n"));
      instance.onwrite?.("tagium-output.mp3", 0, Uint8Array.of(1, 2, 3, 4, 5));
    });

    const blob = await encodeWithLibAV(libav, request, (value) => {
      progress.push(value);
    });

    expect(progress).toEqual([5]);
    expect(blob.type).toBe("audio/mpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3, 4, 5));
    expect(libav.mkreadaheadfile).toHaveBeenCalledWith("tagium-input-0", request.files[0]);
    expect(libav.mkreadaheadfile).toHaveBeenCalledWith("tagium-input-1", request.files[1]);
    expect(libav.mkwriterdev).toHaveBeenCalledWith("tagium-progress.txt");
    expect(libav.mkwriterdev).toHaveBeenCalledWith("tagium-output.mp3");
    expect(libav.unlink).toHaveBeenCalledWith("tagium-output.mp3");
    expect(libav.unlink).toHaveBeenCalledWith("tagium-progress.txt");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-input-0");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-input-1");
    expect(libav.writeFile).not.toHaveBeenCalled();
    expect(arrayBuffers[0]).not.toHaveBeenCalled();
    expect(arrayBuffers[1]).not.toHaveBeenCalled();
    expect(libav.readFile).not.toHaveBeenCalled();
  });

  it("orders output writer chunks by position", async () => {
    const outputSink = createOutputSink();

    outputSink.write(3, Uint8Array.of(4, 5));
    outputSink.write(0, Uint8Array.of(1, 2, 3));

    const blob = outputSink.toBlob("audio/mpeg");

    expect(blob.type).toBe("audio/mpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3, 4, 5));
  });

  it("cleans up attempted inputs when setup fails", async () => {
    const request = createRequest();
    const { libav } = createLibav();
    libav.mkreadaheadfile.mockImplementation(async (name) => {
      if (name === "tagium-input-1") {
        throw new Error("read-ahead setup failed");
      }
    });

    await expect(encodeWithLibAV(libav, request, () => {})).rejects.toThrow(
      "read-ahead setup failed",
    );

    expect(libav.ffmpeg).not.toHaveBeenCalled();
    expect(libav.unlink).toHaveBeenCalledWith("tagium-output.mp3");
    expect(libav.unlink).toHaveBeenCalledWith("tagium-progress.txt");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-input-0");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-input-1");
  });

  it("rejects empty outputs after cleanup", async () => {
    const request = createRequest();
    const { libav } = createLibav(async () => {});

    await expect(encodeWithLibAV(libav, request, () => {})).rejects.toThrow(
      "cobalt local processing produced an empty file.",
    );

    expect(libav.unlink).toHaveBeenCalledWith("tagium-output.mp3");
    expect(libav.unlink).toHaveBeenCalledWith("tagium-progress.txt");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-input-0");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-input-1");
  });
});
