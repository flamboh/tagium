import { describe, expect, it, vi } from "vite-plus/test";
import {
  createOutputSink,
  createProgressSink,
  encodeWithLibAV,
} from "@/features/import/cobaltLocalProcessingWorker.js";

const createRequest = () => ({
  audioFile: new File(["audio"], "audio.wav", { type: "audio/wav" }),
  audio: {
    copy: false,
    format: "mp3",
    bitrate: "128",
  },
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
    const arrayBuffer = vi.spyOn(request.audioFile, "arrayBuffer");
    const { files, libav } = createLibav(async (instance, args) => {
      expect(args).toEqual([
        "-nostdin",
        "-y",
        "-loglevel",
        "error",
        "-progress",
        "tagium-progress.txt",
        "-i",
        "tagium-audio-input",
        "-vn",
        "-b:a",
        "128k",
        "-f",
        "mp3",
        "tagium-output.mp3",
      ]);

      expect(files.get("tagium-audio-input")).toBe(request.audioFile);

      instance.onwrite?.("tagium-progress.txt", 0, new TextEncoder().encode("total_size=5\n"));
      instance.onwrite?.("tagium-output.mp3", 0, Uint8Array.of(1, 2, 3, 4, 5));
    });

    const blob = await encodeWithLibAV(libav, request, (value) => {
      progress.push(value);
    });

    expect(progress).toEqual([5]);
    expect(blob.type).toBe("audio/mpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3, 4, 5));
    expect(libav.mkreadaheadfile).toHaveBeenCalledWith("tagium-audio-input", request.audioFile);
    expect(libav.mkwriterdev).toHaveBeenCalledWith("tagium-progress.txt");
    expect(libav.mkwriterdev).toHaveBeenCalledWith("tagium-output.mp3");
    expect(libav.mkwriterdev).toHaveBeenNthCalledWith(1, "tagium-output.mp3");
    expect(libav.mkwriterdev).toHaveBeenNthCalledWith(2, "tagium-progress.txt");
    expect(libav.ffmpeg.mock.invocationCallOrder[0]).toBeGreaterThan(
      libav.mkwriterdev.mock.invocationCallOrder[1],
    );
    expect(libav.unlink).toHaveBeenCalledWith("tagium-output.mp3");
    expect(libav.unlink).toHaveBeenCalledWith("tagium-progress.txt");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-audio-input");
    expect(libav.writeFile).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(libav.readFile).not.toHaveBeenCalled();
  });

  it("builds copy, m4a, opus, and low-bitrate mp3 audio args", async () => {
    const cases = [
      {
        audio: { copy: true, format: "m4a", bitrate: "320" },
        audioArgs: ["-c:a", "copy", "-f", "ipod"],
        format: "m4a",
      },
      {
        audio: { copy: false, format: "opus", bitrate: "96" },
        audioArgs: ["-b:a", "96k", "-vbr", "off", "-f", "opus"],
        format: "opus",
      },
      {
        audio: { copy: false, format: "mp3", bitrate: "8" },
        audioArgs: ["-b:a", "8k", "-ar", "12000", "-f", "mp3"],
        format: "mp3",
      },
    ];

    for (const { audio, audioArgs, format } of cases) {
      const request = {
        ...createRequest(),
        audio,
        output: {
          format,
          type: "audio/mpeg",
        },
      };
      const { libav } = createLibav((instance, args) => {
        expect(args).toEqual([
          "-nostdin",
          "-y",
          "-loglevel",
          "error",
          "-progress",
          "tagium-progress.txt",
          "-i",
          "tagium-audio-input",
          "-vn",
          ...audioArgs,
          `tagium-output.${format}`,
        ]);

        instance.onwrite?.(`tagium-output.${format}`, 0, Uint8Array.of(1));
      });

      await encodeWithLibAV(libav, request, () => {});
    }
  });

  it("passes sanitized metadata to ffmpeg", async () => {
    const request = {
      ...createRequest(),
      output: {
        format: "mp3",
        type: "audio/mpeg",
        metadata: {
          title: "Ti\u0007t\nle",
          artist: "Artist",
          ignored: "Ignored",
          sublanguage: "en\u001bg",
        },
      },
    };
    const { libav } = createLibav((instance, args) => {
      expect(args).toEqual([
        "-nostdin",
        "-y",
        "-loglevel",
        "error",
        "-progress",
        "tagium-progress.txt",
        "-i",
        "tagium-audio-input",
        "-vn",
        "-b:a",
        "128k",
        "-metadata",
        "title=Title",
        "-metadata",
        "artist=Artist",
        "-metadata:s:s:0",
        "language=eng",
        "-f",
        "mp3",
        "tagium-output.mp3",
      ]);

      instance.onwrite?.("tagium-output.mp3", 0, Uint8Array.of(1));
    });

    await encodeWithLibAV(libav, request, () => {});
  });

  it("writes output bytes at absolute positions", async () => {
    const outputSink = createOutputSink();

    outputSink.write(3, Uint8Array.of(4, 5));
    outputSink.write(0, Uint8Array.of(1, 2, 3));

    const blob = outputSink.toBlob("audio/mpeg");

    expect(blob.type).toBe("audio/mpeg");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.of(1, 2, 3, 4, 5));
  });

  it("overwrites output bytes at seek positions", async () => {
    const outputSink = createOutputSink();

    outputSink.write(0, Uint8Array.of(1, 2, 9, 9, 5));
    outputSink.write(2, Uint8Array.of(3, 4));
    outputSink.write(1, Uint8Array.of(6, 7, 8));

    const blob = outputSink.toBlob("audio/mp4");

    expect(blob.type).toBe("audio/mp4");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.of(1, 6, 7, 8, 5));
  });

  it("keeps existing tail bytes when a shorter seek write overwrites the start", async () => {
    const outputSink = createOutputSink();

    outputSink.write(0, Uint8Array.of(1, 2, 3, 4));
    outputSink.write(0, Uint8Array.of(9, 8));

    expect(new Uint8Array(await outputSink.toBlob("audio/mpeg").arrayBuffer())).toEqual(
      Uint8Array.of(9, 8, 3, 4),
    );
  });

  it("does not recopy accumulated bytes for sequential output writes", async () => {
    const outputSink = createOutputSink();
    let copiedBytes = 0;
    const set = vi.spyOn(Uint8Array.prototype, "set").mockImplementation(function (source, offset) {
      copiedBytes += source.length;
      const start = offset ?? 0;
      for (let index = 0; index < source.length; index += 1) {
        this[start + index] = source[index];
      }
    });

    try {
      for (let value = 0; value < 32; value += 1) {
        outputSink.write(value, Uint8Array.of(value));
      }

      const bytes = new Uint8Array(await outputSink.toBlob("audio/mpeg").arrayBuffer());

      expect(bytes).toEqual(Uint8Array.from({ length: 32 }, (_, value) => value));
      expect(copiedBytes).toBe(32);
    } finally {
      set.mockRestore();
    }
  });

  it("cleans up attempted inputs when setup fails", async () => {
    const request = createRequest();
    const { libav } = createLibav();
    libav.mkreadaheadfile.mockImplementation(async () => {
      throw new Error("read-ahead setup failed");
    });

    await expect(encodeWithLibAV(libav, request, () => {})).rejects.toThrow(
      "read-ahead setup failed",
    );

    expect(libav.ffmpeg).not.toHaveBeenCalled();
    expect(libav.unlink).toHaveBeenCalledWith("tagium-output.mp3");
    expect(libav.unlink).toHaveBeenCalledWith("tagium-progress.txt");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-audio-input");
  });

  it("cleans up when ffmpeg fails", async () => {
    const request = createRequest();
    const { libav } = createLibav(async () => {
      throw new Error("ffmpeg failed");
    });

    await expect(encodeWithLibAV(libav, request, () => {})).rejects.toThrow("ffmpeg failed");

    expect(libav.unlink).toHaveBeenCalledWith("tagium-output.mp3");
    expect(libav.unlink).toHaveBeenCalledWith("tagium-progress.txt");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-audio-input");
  });

  it("keeps the original error when cleanup fails", async () => {
    const request = createRequest();
    const { libav } = createLibav(async () => {
      throw new Error("ffmpeg failed");
    });
    libav.unlink.mockRejectedValue(new Error("cleanup failed"));

    await expect(encodeWithLibAV(libav, request, () => {})).rejects.toThrow("ffmpeg failed");
  });

  it("rejects empty outputs after cleanup", async () => {
    const request = createRequest();
    const { libav } = createLibav(async () => {});

    await expect(encodeWithLibAV(libav, request, () => {})).rejects.toThrow(
      "local audio processing produced an empty file.",
    );

    expect(libav.unlink).toHaveBeenCalledWith("tagium-output.mp3");
    expect(libav.unlink).toHaveBeenCalledWith("tagium-progress.txt");
    expect(libav.unlinkreadaheadfile).toHaveBeenCalledWith("tagium-audio-input");
  });
});
