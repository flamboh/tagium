/*
 * Adapted from imputnet/cobalt:
 * - web/src/lib/libav.ts
 * - web/src/lib/task-manager/workers/ffmpeg.ts
 *
 * Changes: standalone audio encoder worker for Tagium downloads.
 */
import EncodeLibAV from "@imput/libav.js-encode-cli";

const progressEntries = (data) =>
  Object.fromEntries(
    new TextDecoder()
      .decode(new Uint8Array(data))
      .split("\n")
      .filter(Boolean)
      .map((entry) => entry.split("=")),
  );

const render = async (libav, request) => {
  const outputName = `output.${request.output.format}`;
  const chunks = [];

  try {
    const ffInputs = [];
    for (const [index, file] of request.files.entries()) {
      const inputName = `input${index}`;
      await libav.mkreadaheadfile(inputName, file);
      ffInputs.push("-i", inputName);
    }

    await libav.mkwriterdev(outputName);
    await libav.mkwriterdev("progress.txt");

    libav.onwrite = async (name, position, data) => {
      if (name === "progress.txt") {
        const entries = progressEntries(data);
        const size = Number(entries.total_size);
        self.postMessage({
          cobaltLocalProcessing: {
            progress: Number.isNaN(size) ? undefined : size,
          },
        });
        return;
      }

      if (name === outputName) {
        chunks.push({ position, data: new Uint8Array(data) });
      }
    };

    await libav.ffmpeg([
      "-nostdin",
      "-y",
      "-loglevel",
      "error",
      "-progress",
      "progress.txt",
      ...ffInputs,
      ...request.args,
      outputName,
    ]);

    chunks.sort((a, b) => a.position - b.position);
    const blob = new Blob(
      chunks.map((chunk) => chunk.data),
      { type: request.output.type },
    );
    if (blob.size === 0) {
      throw new Error("cobalt local processing produced an empty file.");
    }

    return blob;
  } finally {
    await Promise.allSettled([
      libav.unlink(outputName),
      libav.unlink("progress.txt"),
      ...request.files.map((_, index) => libav.unlinkreadaheadfile(`input${index}`)),
    ]);
  }
};

self.onmessage = async (event) => {
  const request = event.data.cobaltLocalProcessing;
  if (!request) {
    return;
  }

  const libav = await EncodeLibAV.LibAV({
    base: "/_libav",
    noworker: true,
  });

  try {
    const blob = await render(libav, request);
    self.postMessage({
      cobaltLocalProcessing: {
        blob,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "cobalt local processing failed.";
    self.postMessage({
      cobaltLocalProcessing: {
        error: message,
      },
    });
  } finally {
    libav.terminate();
  }
};
