import EncodeLibAV, { type LibAV as LibAVInstance } from "@imput/libav.js-encode-cli";
import type { CobaltLocalProcessingPlan } from "./cobaltDownloadSchemas";
import { createTemporaryFileStore } from "./storage";
import {
  makeLocalProcessingFfmpegArgs,
  outputFormatFromFilename,
  VIDEO_PROGRESS_FILENAME,
} from "./ffmpegArgs";

export const VIDEO_INPUT_PREFIX = "tagium-video-input";

export type VideoWorkerProcessingRequest = {
  files: File[];
  plan: CobaltLocalProcessingPlan;
};

export type VideoWorkerProgress = {
  bytesWritten?: number;
  progress?: number;
  status?: "running" | "complete";
};

export type VideoWorkerMessage =
  | { progress: VideoWorkerProgress }
  | { blob: Blob; opfsEntryName?: string }
  | { error: string };

export type VideoWorkerCancelRequest = { cancel: true };

export type VideoWorkerRequest = VideoWorkerProcessingRequest | VideoWorkerCancelRequest;

type LibAVLike = {
  onwrite?: (name: string, position: number, data: Uint8Array | Int8Array) => void;
  mkreadaheadfile: (name: string, file: Blob) => Promise<void>;
  mkwriterdev: (name: string) => Promise<void>;
  ffmpeg: (args: string[]) => Promise<number | void>;
  unlink: (name: string) => Promise<void>;
  unlinkreadaheadfile: (name: string) => Promise<void>;
  terminate: () => void;
};

const outputName = (plan: CobaltLocalProcessingPlan) =>
  `tagium-video-output.${outputFormatFromFilename(plan.output.filename)}`;

let activeLibAV: LibAVLike | undefined;
let cancellationRequested = false;

/**
 * Parses LibAV's key/value progress stream while retaining partial lines
 * between writes. Only output-size and terminal progress are exposed to the
 * Tagium Save; the stream can contain implementation-specific fields.
 */
export const createProgressSink = (postProgress: (progress: VideoWorkerProgress) => void) => {
  const decoder = new TextDecoder();
  let pending = "";

  return (data: Uint8Array | Int8Array) => {
    pending += decoder.decode(new Uint8Array(data), { stream: true });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";

    const values = new Map<string, string>();
    for (const line of lines) {
      const separator = line.indexOf("=");
      if (separator < 0) continue;
      values.set(line.slice(0, separator), line.slice(separator + 1));
    }

    const rawSize = values.get("total_size");
    const parsedSize = rawSize === undefined ? undefined : Number(rawSize);
    const bytesWritten =
      parsedSize !== undefined && Number.isFinite(parsedSize) && parsedSize >= 0
        ? parsedSize
        : undefined;
    const status = values.get("progress");
    if (bytesWritten !== undefined || status === "end") {
      postProgress({
        ...(bytesWritten !== undefined ? { bytesWritten } : {}),
        ...(status === "end" ? { progress: 1, status: "complete" } : { status: "running" }),
      });
    }
  };
};

const unlinkCreatedFiles = async (
  libav: LibAVLike,
  inputNames: readonly string[],
  output: string,
) => {
  await Promise.allSettled([
    libav.unlink(output),
    libav.unlink(VIDEO_PROGRESS_FILENAME),
    ...inputNames.map((name) => libav.unlinkreadaheadfile(name)),
  ]);
};

/**
 * Runs a Cobalt local-processing plan using the installed encode-only LibAV
 * build. Writer callbacks are queued so asynchronous OPFS writes preserve
 * LibAV's absolute seek positions before the output file is finalized.
 */
export const encodeWithLibAV = async (
  libav: LibAVLike,
  request: VideoWorkerProcessingRequest,
  postProgress: (progress: VideoWorkerProgress) => void,
) => {
  if (request.files.length === 0) {
    throw new Error("local video processing received no input files.");
  }

  const inputNames = request.files.map((_, index) => `${VIDEO_INPUT_PREFIX}-${index}`);
  const output = outputName(request.plan);
  const outputStore = await createTemporaryFileStore("tagium-video-output");
  const progressSink = createProgressSink(postProgress);
  let pendingWrites = Promise.resolve();
  let outputLeased = false;

  libav.onwrite = (name, position, data) => {
    if (name === VIDEO_PROGRESS_FILENAME) {
      progressSink(data);
      return;
    }
    if (name !== output) return;

    const copy = Uint8Array.from(data);
    pendingWrites = pendingWrites.then(() => outputStore.write(position, copy));
  };

  try {
    await Promise.all(
      request.files.map((file, index) => {
        const inputName = inputNames[index];
        if (!inputName) throw new Error("local video processing input names are out of sync.");
        return libav.mkreadaheadfile(inputName, file);
      }),
    );

    await libav.mkwriterdev(output);
    await libav.mkwriterdev(VIDEO_PROGRESS_FILENAME);
    const exitStatus = await libav.ffmpeg(
      makeLocalProcessingFfmpegArgs(request.plan, inputNames, output),
    );
    await pendingWrites;

    if (typeof exitStatus === "number" && exitStatus !== 0) {
      throw new Error(`local video processing failed with status ${exitStatus}.`);
    }

    if (outputStore.size === 0) {
      throw new Error("local video processing produced an empty file.");
    }

    postProgress({ bytesWritten: outputStore.size, progress: 1, status: "complete" });
    const outputLease = await outputStore.toBlob(request.plan.output.type);
    outputLeased = true;
    return outputLease;
  } finally {
    await pendingWrites.catch(() => undefined);
    await unlinkCreatedFiles(libav, inputNames, output);
    if (!outputLeased) await outputStore.cleanup();
  }
};

const createLibAV = async (): Promise<LibAVLike> => {
  const libav: LibAVInstance = await EncodeLibAV.LibAV({
    base: "/_libav",
    noworker: true,
  });
  return libav;
};

const errorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "local video processing failed.";
};

export const processLocalVideo = async (request: VideoWorkerProcessingRequest) => {
  let libav: LibAVLike | undefined;
  try {
    libav = await createLibAV();
    if (cancellationRequested) {
      libav.terminate();
      throw new Error("download cancelled.");
    }
    activeLibAV = libav;
    const outputLease = await encodeWithLibAV(libav, request, (progress) => {
      postVideoWorkerMessage({ progress });
    });
    let transferred = false;
    try {
      if (cancellationRequested) throw new Error("download cancelled.");
      const outputMessage: VideoWorkerMessage = outputLease.opfsEntryName
        ? { blob: outputLease.value, opfsEntryName: outputLease.opfsEntryName }
        : { blob: outputLease.value };
      transferred = postVideoWorkerMessage(outputMessage);
    } finally {
      if (!transferred || !outputLease.opfsEntryName) await outputLease.release();
    }
  } catch (error) {
    postVideoWorkerMessage({ error: errorMessage(error) });
  } finally {
    if (activeLibAV === libav) activeLibAV = undefined;
    libav?.terminate();
  }
};

const cancelLocalVideo = () => {
  cancellationRequested = true;
  activeLibAV?.terminate();
};

const postVideoWorkerMessage = (message: VideoWorkerMessage) => {
  if (typeof self === "undefined") return false;
  self.postMessage({ cobaltVideoProcessing: message });
  return true;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isVideoWorkerProcessingRequest = (value: unknown): value is VideoWorkerProcessingRequest => {
  if (!isRecord(value) || !Array.isArray(value.files) || !isRecord(value.plan)) return false;
  if (!value.files.every((file) => file instanceof Blob)) return false;
  return (
    value.plan.status === "local-processing" &&
    typeof value.plan.type === "string" &&
    Array.isArray(value.plan.tunnel) &&
    isRecord(value.plan.output)
  );
};

const isVideoWorkerCancelRequest = (value: unknown): value is VideoWorkerCancelRequest =>
  isRecord(value) && value.cancel === true;

if (typeof self !== "undefined") {
  self.onmessage = async (event: MessageEvent<unknown>) => {
    if (!isRecord(event.data)) return;
    const requestData = event.data.cobaltVideoProcessing;
    if (isVideoWorkerCancelRequest(requestData)) {
      cancelLocalVideo();
      return;
    }
    if (!isVideoWorkerProcessingRequest(requestData)) return;
    cancellationRequested = false;
    const request = requestData;
    await processLocalVideo(request);
  };
}
