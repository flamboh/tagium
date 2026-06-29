import EncodeLibAV from "@imput/libav.js-encode-cli";

const inputName = (index) => `tagium-input-${index}`;
const outputName = (format) => `tagium-output.${format}`;
const progressName = "tagium-progress.txt";

const postLocalProcessingMessage = (message) => {
  globalThis.self.postMessage({
    cobaltLocalProcessing: message,
  });
};

export const createProgressSink = (postProgress) => {
  const decoder = new TextDecoder();
  let pending = "";

  return (data) => {
    pending += decoder.decode(new Uint8Array(data), { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";

    for (const line of lines) {
      const separator = line.indexOf("=");
      if (separator === -1) {
        continue;
      }

      const key = line.slice(0, separator);
      if (key !== "total_size") {
        continue;
      }

      const value = line.slice(separator + 1);
      const progress = Number(value);
      if (value && Number.isFinite(progress)) {
        postProgress(progress);
        continue;
      }

      postProgress(undefined);
    }
  };
};

export const createOutputSink = () => {
  const chunks = [];

  return {
    write(position, data) {
      chunks.push({ position, data: new Uint8Array(data) });
    },
    toBlob(type) {
      chunks.sort((a, b) => a.position - b.position);
      return new Blob(
        chunks.map((chunk) => chunk.data),
        { type },
      );
    },
  };
};

const makeFfmpegArgs = (request) => [
  "-nostdin",
  "-y",
  "-loglevel",
  "error",
  "-progress",
  progressName,
  ...request.files.flatMap((_, index) => ["-i", inputName(index)]),
  ...request.args,
  outputName(request.output.format),
];

const unlinkCreatedFiles = async (libav, request, registeredInputNames) => {
  await Promise.allSettled([
    libav.unlink(outputName(request.output.format)),
    libav.unlink(progressName),
    ...registeredInputNames.map((name) => libav.unlinkreadaheadfile(name)),
  ]);
};

export const encodeWithLibAV = async (libav, request, postProgress) => {
  const registeredInputNames = [];
  const progressSink = createProgressSink(postProgress);
  const outputSink = createOutputSink();

  libav.onwrite = (name, _position, data) => {
    if (name === progressName) {
      progressSink(data);
      return;
    }

    if (name === outputName(request.output.format)) {
      outputSink.write(_position, data);
    }
  };

  try {
    for (const [index, file] of request.files.entries()) {
      const name = inputName(index);
      registeredInputNames.push(name);
      await libav.mkreadaheadfile(name, file);
    }

    await libav.mkwriterdev(outputName(request.output.format));
    await libav.mkwriterdev(progressName);
    await libav.ffmpeg(makeFfmpegArgs(request));

    const blob = outputSink.toBlob(request.output.type);
    if (blob.size === 0) {
      throw new Error("cobalt local processing produced an empty file.");
    }

    return blob;
  } finally {
    await unlinkCreatedFiles(libav, request, registeredInputNames);
  }
};

const createLibAV = async () =>
  await EncodeLibAV.LibAV({
    base: "/_libav",
    noworker: true,
  });

const errorMessage = (error) => {
  if (error instanceof Error) {
    return error.message;
  }

  return "cobalt local processing failed.";
};

export const processLocalAudio = async (request) => {
  let libav;

  try {
    libav = await createLibAV();
    const blob = await encodeWithLibAV(libav, request, (progress) => {
      postLocalProcessingMessage({ progress });
    });
    postLocalProcessingMessage({ blob });
  } catch (error) {
    postLocalProcessingMessage({ error: errorMessage(error) });
  } finally {
    libav?.terminate();
  }
};

// Tagium owns this worker implementation; the envelope name stays for caller compatibility.
if (globalThis.self) {
  globalThis.self.onmessage = async (event) => {
    const request = event.data.cobaltLocalProcessing;
    if (!request) {
      return;
    }

    await processLocalAudio(request);
  };
}
