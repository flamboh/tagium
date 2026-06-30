/*
 * Adapted from imputnet/cobalt's browser LibAV local-processing path.
 * Tagium keeps the single-audio-file workflow and streams output through
 * LibAV writer devices instead of loading input/output through MEMFS.
 */
import EncodeLibAV from "@imput/libav.js-encode-cli";

const inputName = "tagium-audio-input";
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
  const patches = [];
  let size = 0;

  return {
    write(position, data) {
      const patch = Uint8Array.from(new Uint8Array(data));
      const end = position + patch.length;
      if (end > size) {
        size = end;
      }

      patches.push({ position, data: patch });
    },
    toBlob(type) {
      const bytes = new Uint8Array(size);
      for (const patch of patches) {
        bytes.set(patch.data, patch.position);
      }

      return new Blob([bytes], { type });
    },
  };
};

const makeAudioFfmpegArgs = (request) => {
  const args = [
    "-nostdin",
    "-y",
    "-loglevel",
    "error",
    "-progress",
    progressName,
    "-i",
    inputName,
    "-vn",
  ];

  if (request.audio.copy) {
    args.push("-c:a", "copy");
  } else {
    args.push("-b:a", `${request.audio.bitrate}k`);
  }

  if (request.audio.format === "mp3" && request.audio.bitrate === "8") {
    args.push("-ar", "12000");
  }

  if (request.audio.format === "opus") {
    args.push("-vbr", "off");
  }

  if (request.audio.format === "m4a") {
    args.push("-f", "ipod");
  } else {
    args.push("-f", request.audio.format);
  }

  args.push(outputName(request.output.format));

  return args;
};

const unlinkCreatedFiles = async (libav, request, inputRegistered) => {
  await Promise.allSettled([
    libav.unlink(outputName(request.output.format)),
    libav.unlink(progressName),
    inputRegistered ? libav.unlinkreadaheadfile(inputName) : Promise.resolve(),
  ]);
};

export const encodeWithLibAV = async (libav, request, postProgress) => {
  let inputRegistered = false;
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
    inputRegistered = true;
    await libav.mkreadaheadfile(inputName, request.audioFile);

    await libav.mkwriterdev(outputName(request.output.format));
    await libav.mkwriterdev(progressName);
    await libav.ffmpeg(makeAudioFfmpegArgs(request));

    const blob = outputSink.toBlob(request.output.type);
    if (blob.size === 0) {
      throw new Error("local audio processing produced an empty file.");
    }

    return blob;
  } finally {
    await unlinkCreatedFiles(libav, request, inputRegistered);
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

  return "local audio processing failed.";
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

if (globalThis.self) {
  globalThis.self.onmessage = async (event) => {
    const request = event.data.cobaltLocalProcessing;
    if (!request) {
      return;
    }

    await processLocalAudio(request);
  };
}
