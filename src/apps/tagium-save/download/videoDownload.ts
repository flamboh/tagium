import { Effect } from "effect";
import { cobaltDownloadScheduler } from "@/shared/cobalt/cobaltDownloadScheduler";
import {
  decodeCobaltDownloadResponseEffect,
  makeCobaltVideoDownloadRequestBody,
  type CobaltDownloadResponse,
  type CobaltDownloadPlan,
  type CobaltLocalProcessingPlan,
  type CobaltPickerItem,
  type CobaltVideoDownloadRequest,
} from "./cobaltDownloadSchemas";
import { outputFormatFromFilename } from "./ffmpegArgs";

/** The browser-facing Cobalt request accepted by the downloader. */
export type VideoDownloadRequest = CobaltVideoDownloadRequest;
/** A decoded Cobalt response that can be executed or shown to the user. */
export type VideoDownloadPlan = CobaltDownloadPlan;

import {
  adoptTemporaryFileLease,
  createTemporaryFileStore,
  type TemporaryFileLease,
} from "./storage";
import type {
  VideoWorkerMessage,
  VideoWorkerCancelRequest,
  VideoWorkerProcessingRequest,
  VideoWorkerProgress,
} from "./cobaltVideoProcessingWorker";

export type VideoDownloadPhase =
  | "planning"
  | "waiting-for-tunnel"
  | "downloading"
  | "processing"
  | "finalizing";

export type VideoDownloadProgress = {
  phase: VideoDownloadPhase;
  progress?: number;
  bytesReceived?: number;
  totalBytes?: number;
  resourceIndex?: number;
  resourceCount?: number;
};

export type VideoDownloadCallbacks = {
  signal?: AbortSignal;
  onStage?: (stage: VideoDownloadPhase) => void;
  onProgress?: (progress: VideoDownloadProgress) => void;
};

export interface VideoDownloadTask<Result> {
  readonly promise: Promise<Result>;
  readonly signal: AbortSignal;
  readonly abort: (reason?: unknown) => void;
}

export type VideoFileDownloadResult = {
  status: "file";
  file: File;
  release: () => Promise<void>;
};

export type VideoPickerDownloadResult = {
  status: "picker";
  picker: readonly CobaltPickerItem[];
  audioFilename?: string;
  downloadAudio?: (
    callbacks?: VideoDownloadCallbacks,
  ) => VideoDownloadTask<VideoFileDownloadResult>;
  download: (
    item: CobaltPickerItem,
    callbacks?: VideoDownloadCallbacks,
  ) => VideoDownloadTask<VideoFileDownloadResult>;
};

export type VideoDownloadResult = VideoFileDownloadResult | VideoPickerDownloadResult;

export type VideoDownloadStage = "planning" | "tunnel" | "processing" | "finalizing";

export class VideoDownloadError extends Error {
  readonly stage: VideoDownloadStage;
  readonly code?: string;

  constructor(stage: VideoDownloadStage, message: string, code?: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "VideoDownloadError";
    this.stage = stage;
    this.code = code;
  }
}

const defaultAbortReason = () => {
  if (typeof DOMException !== "undefined") {
    return new DOMException("download cancelled.", "AbortError");
  }
  return new Error("download cancelled.");
};

const createTask = <Result>(
  work: (signal: AbortSignal) => Promise<Result>,
  externalSignal?: AbortSignal,
): VideoDownloadTask<Result> => {
  const controller = new AbortController();
  const abortFromExternalSignal = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      abortFromExternalSignal();
    } else {
      externalSignal.addEventListener("abort", abortFromExternalSignal, { once: true });
    }
  }

  const promise = Promise.resolve()
    .then(() => work(controller.signal))
    .finally(() => {
      externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    });

  return {
    promise,
    signal: controller.signal,
    abort: (reason = defaultAbortReason()) => controller.abort(reason),
  };
};

const mapTask = <Input, Output>(
  task: VideoDownloadTask<Input>,
  map: (value: Input) => Output,
): VideoDownloadTask<Output> => ({
  signal: task.signal,
  abort: task.abort,
  promise: task.promise.then(map),
});

const isAbortError = (error: unknown) => error instanceof Error && error.name === "AbortError";

const errorText = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
};

const lowerCaseMessage = (message: string) => {
  const firstCharacter = message[0];
  return firstCharacter ? `${firstCharacter.toLowerCase()}${message.slice(1)}` : message;
};

const makeRequestId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tagium-video-${Date.now().toString(36)}`;

const stableLastModified = (sourceUrl: string) =>
  Array.from(sourceUrl).reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) % 2_147_483_647,
    1,
  );

const safeFilename = (filename: string) => {
  const cleaned = filename.replaceAll("/", "_").replaceAll("\\", "_").replaceAll("\0", "_").trim();
  return cleaned || `tagium-video.${outputFormatFromFilename(filename)}`;
};

const parseContentLength = (response: Response) => {
  const raw =
    response.headers.get("Content-Length") ?? response.headers.get("Estimated-Content-Length");
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const length = Number(raw);
  return Number.isSafeInteger(length) && length > 0 ? length : undefined;
};

const report = (callbacks: VideoDownloadCallbacks | undefined, progress: VideoDownloadProgress) => {
  callbacks?.onStage?.(progress.phase);
  callbacks?.onProgress?.(progress);
};

const fileDownloadResult = (lease: TemporaryFileLease<File>): VideoFileDownloadResult => ({
  status: "file",
  file: lease.value,
  release: lease.release,
});

const decodeResponse = async (response: Response): Promise<CobaltDownloadResponse> => {
  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    throw new VideoDownloadError(
      "planning",
      `cobalt request failed with status ${response.status}.`,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    const message =
      response.status === 429
        ? "too many downloads too quickly. wait a moment, then try again."
        : lowerCaseMessage(text.trim());
    const code = response.status === 429 ? "rate_limited" : undefined;
    throw new VideoDownloadError("planning", message, code, error);
  }

  try {
    return await Effect.runPromise(decodeCobaltDownloadResponseEffect(body));
  } catch (error) {
    throw new VideoDownloadError(
      "planning",
      "cobalt returned an invalid download plan.",
      undefined,
      error,
    );
  }
};

const fetchPlan = async (
  request: CobaltVideoDownloadRequest,
  callbacks: VideoDownloadCallbacks | undefined,
  signal: AbortSignal,
) => {
  report(callbacks, { phase: "planning", progress: 0 });
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Tagium-Request-Id": makeRequestId(),
  });
  if (request.importId) headers.set("X-Tagium-Import-Id", request.importId);
  if (request.trackIndex !== undefined)
    headers.set("X-Tagium-Track-Index", String(request.trackIndex));

  let response: Response;
  try {
    response = await fetch("/api/cobalt/download", {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify(makeCobaltVideoDownloadRequestBody(request)),
    });
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw error;
    throw new VideoDownloadError(
      "planning",
      errorText(error, "cobalt request failed."),
      undefined,
      error,
    );
  }

  if (!response.ok) {
    const body = await decodeResponse(response);
    if (body.status === "error") {
      throw new VideoDownloadError("planning", body.error.code, body.error.code);
    }
    throw new VideoDownloadError(
      "planning",
      `cobalt request failed with status ${response.status}.`,
    );
  }

  return decodeResponse(response);
};

const fetchTunnelFile = async (
  url: string,
  filename: string,
  sourceUrl: string,
  callbacks: VideoDownloadCallbacks | undefined,
  signal: AbortSignal,
  resourceIndex: number,
  resourceCount: number,
  fallbackContentType?: string,
) => {
  report(callbacks, {
    phase: "waiting-for-tunnel",
    resourceIndex,
    resourceCount,
  });
  await cobaltDownloadScheduler.waitForTunnelStart({ signal });

  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal.aborted || isAbortError(error)) throw error;
    throw new VideoDownloadError(
      "tunnel",
      errorText(error, "cobalt tunnel request failed."),
      undefined,
      error,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new VideoDownloadError(
      "tunnel",
      text.trim() || `cobalt tunnel request failed with status ${response.status}.`,
    );
  }

  const contentType =
    response.headers.get("Content-Type") || fallbackContentType || "application/octet-stream";
  const totalBytes = parseContentLength(response);
  const inputStore = await createTemporaryFileStore("tagium-video-input");
  let bytesReceived = 0;
  let fileLeased = false;
  try {
    const reader = response.body?.getReader();
    if (!reader) {
      const blob = await response.blob();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await inputStore.write(0, bytes);
      bytesReceived = bytes.byteLength;
      report(callbacks, {
        phase: "downloading",
        progress: totalBytes ? bytesReceived / totalBytes : undefined,
        bytesReceived,
        totalBytes,
        resourceIndex,
        resourceCount,
      });
    } else {
      try {
        while (true) {
          signal.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) break;
          await inputStore.append(chunk.value);
          bytesReceived += chunk.value.byteLength;
          report(callbacks, {
            phase: "downloading",
            progress: totalBytes ? Math.min(bytesReceived / totalBytes, 1) : undefined,
            bytesReceived,
            totalBytes,
            resourceIndex,
            resourceCount,
          });
        }
      } finally {
        reader.releaseLock();
      }
    }

    if (inputStore.size === 0) {
      throw new VideoDownloadError("tunnel", "cobalt tunnel response was empty.");
    }

    const fileLease = await inputStore.toFile(
      safeFilename(filename),
      contentType,
      stableLastModified(sourceUrl),
    );
    fileLeased = true;
    return fileLease;
  } finally {
    if (!fileLeased) await inputStore.cleanup();
  }
};

const localPlanMediaInputCount = (plan: CobaltLocalProcessingPlan) =>
  plan.output.subtitles ? plan.tunnel.length - 1 : plan.tunnel.length;

const pickerTypeDefaults: Record<
  CobaltPickerItem["type"],
  { extension: string; contentType: string }
> = {
  photo: { extension: "jpg", contentType: "image/jpeg" },
  video: { extension: "mp4", contentType: "video/mp4" },
  gif: { extension: "gif", contentType: "image/gif" },
};

const pickerFilename = (item: CobaltPickerItem) => {
  const fallback = pickerTypeDefaults[item.type];
  let pathSegment = "";
  try {
    const base = typeof location === "undefined" ? "https://tagium.invalid" : location.href;
    const pathname = new URL(item.url, base).pathname;
    pathSegment = decodeURIComponent(pathname.slice(pathname.lastIndexOf("/") + 1));
  } catch {
    pathSegment = "";
  }

  const hasExtension = /\.[a-z0-9]{1,12}$/i.test(pathSegment);
  return hasExtension ? safeFilename(pathSegment) : `tagium-${item.type}.${fallback.extension}`;
};

const pickerContentType = (item: CobaltPickerItem) => pickerTypeDefaults[item.type].contentType;

const validateLocalPlan = (plan: CobaltLocalProcessingPlan) => {
  if (plan.tunnel.length === 0) {
    throw new VideoDownloadError("processing", "cobalt local processing response has no tunnels.");
  }

  const mediaCount = localPlanMediaInputCount(plan);
  if (mediaCount < 1 || mediaCount > 2) {
    throw new VideoDownloadError(
      "processing",
      "cobalt local processing response has invalid tunnels.",
    );
  }
  if (plan.type === "merge" && mediaCount !== 2) {
    throw new VideoDownloadError(
      "processing",
      "cobalt merge response is missing its audio tunnel.",
    );
  }
  if (plan.output.subtitles && plan.tunnel.length < 2) {
    throw new VideoDownloadError(
      "processing",
      "cobalt local processing response is missing subtitles.",
    );
  }
  if (plan.type === "audio" && !plan.audio) {
    throw new VideoDownloadError("processing", "cobalt audio response is missing audio settings.");
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isWorkerProgress = (value: unknown): value is VideoWorkerProgress => {
  if (!isRecord(value)) return false;
  const record = value;
  return (
    (record.progress === undefined || typeof record.progress === "number") &&
    (record.bytesWritten === undefined || typeof record.bytesWritten === "number") &&
    (record.status === undefined || record.status === "running" || record.status === "complete")
  );
};

const decodeWorkerMessage = (value: unknown): VideoWorkerMessage | undefined => {
  if (typeof value !== "object" || value === null || !("cobaltVideoProcessing" in value)) return;
  const message = value.cobaltVideoProcessing;
  if (typeof message !== "object" || message === null) return;

  if ("blob" in message && message.blob instanceof Blob) {
    const opfsEntryName = "opfsEntryName" in message ? message.opfsEntryName : undefined;
    if (opfsEntryName !== undefined && typeof opfsEntryName !== "string") return;
    return opfsEntryName ? { blob: message.blob, opfsEntryName } : { blob: message.blob };
  }
  if ("error" in message && typeof message.error === "string") {
    return { error: message.error };
  }
  if ("progress" in message && isWorkerProgress(message.progress)) {
    return { progress: message.progress };
  }
  return undefined;
};

const runLocalProcessingWorker = (
  plan: CobaltLocalProcessingPlan,
  files: File[],
  sourceUrl: string,
  callbacks: VideoDownloadCallbacks | undefined,
  signal: AbortSignal,
) =>
  new Promise<TemporaryFileLease<File>>((resolve, reject) => {
    if (typeof Worker === "undefined") {
      reject(
        new VideoDownloadError(
          "processing",
          "local video processing is unavailable in this browser.",
        ),
      );
      return;
    }

    const worker = new Worker(new URL("./cobaltVideoProcessingWorker.ts", import.meta.url), {
      type: "module",
    });
    report(callbacks, { phase: "processing", progress: 0 });
    let settled = false;
    let cancelled = false;
    let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
    const cancellationError = () => new VideoDownloadError("processing", "download cancelled.");
    const finish = (result: TemporaryFileLease<File> | Error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (cancellationTimer !== undefined) clearTimeout(cancellationTimer);
      worker.terminate();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const onAbort = () => {
      if (settled) return;
      cancelled = true;
      const cancelRequest: VideoWorkerCancelRequest = { cancel: true };
      try {
        worker.postMessage({ cobaltVideoProcessing: cancelRequest });
      } catch {
        finish(cancellationError());
        return;
      }
      cancellationTimer = setTimeout(() => finish(cancellationError()), 500);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    worker.onerror = (event) =>
      finish(
        cancelled
          ? cancellationError()
          : new VideoDownloadError("processing", event.message || "local video processing failed."),
      );
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const message = decodeWorkerMessage(event.data);
      if (!message) return;
      if ("progress" in message) {
        const progress: VideoWorkerProgress = message.progress;
        report(callbacks, {
          phase: "processing",
          progress: progress.progress,
          bytesReceived: progress.bytesWritten,
        });
        return;
      }
      if ("error" in message) {
        finish(
          cancelled ? cancellationError() : new VideoDownloadError("processing", message.error),
        );
        return;
      }

      if (cancelled) {
        const abandonedOutput = adoptTemporaryFileLease(
          new File([message.blob], safeFilename(plan.output.filename), {
            type: plan.output.type,
            lastModified: stableLastModified(sourceUrl),
          }),
          message.opfsEntryName,
        );
        void abandonedOutput.release().finally(() => finish(cancellationError()));
        return;
      }

      report(callbacks, { phase: "finalizing", progress: 0 });
      finish(
        adoptTemporaryFileLease(
          new File([message.blob], safeFilename(plan.output.filename), {
            type: plan.output.type,
            lastModified: stableLastModified(sourceUrl),
          }),
          message.opfsEntryName,
        ),
      );
    };

    const request: VideoWorkerProcessingRequest = { files, plan };
    try {
      worker.postMessage({ cobaltVideoProcessing: request });
    } catch (error) {
      finish(
        new VideoDownloadError(
          "processing",
          errorText(error, "local video processing failed."),
          undefined,
          error,
        ),
      );
    }
  });

const executePlan = async (
  plan: CobaltDownloadPlan,
  request: CobaltVideoDownloadRequest,
  callbacks: VideoDownloadCallbacks | undefined,
  signal: AbortSignal,
  allowPicker: boolean,
): Promise<VideoDownloadResult> => {
  if (plan.status === "picker") {
    if (!allowPicker) {
      throw new VideoDownloadError(
        "planning",
        "cobalt returned another picker for the selected item.",
      );
    }
    const audio = plan.audio;
    const pickerResult: VideoPickerDownloadResult = {
      status: "picker",
      picker: plan.picker,
      download: (item, pickerCallbacks) => downloadVideoPickerItem(request, item, pickerCallbacks),
    };
    if (audio) {
      pickerResult.audioFilename = plan.audioFilename ?? "tagium-audio";
      pickerResult.downloadAudio = (pickerCallbacks) =>
        startPickerResourceDownload(request, pickerCallbacks, (signal) =>
          executePickerAudio(request, audio, plan.audioFilename, pickerCallbacks, signal),
        );
    }
    return pickerResult;
  }
  if (plan.status === "tunnel" || plan.status === "redirect") {
    const fileLease = await fetchTunnelFile(
      plan.url,
      plan.filename,
      request.sourceUrl,
      callbacks,
      signal,
      0,
      1,
    );
    report(callbacks, { phase: "finalizing", progress: 1 });
    return fileDownloadResult(fileLease);
  }

  validateLocalPlan(plan);
  if (plan.type === "proxy") {
    const tunnel = plan.tunnel[0];
    if (!tunnel) {
      throw new VideoDownloadError("processing", "cobalt proxy response is missing its tunnel.");
    }
    const fileLease = await fetchTunnelFile(
      tunnel,
      plan.output.filename,
      request.sourceUrl,
      callbacks,
      signal,
      0,
      1,
    );
    report(callbacks, { phase: "finalizing", progress: 1 });
    return fileDownloadResult(fileLease);
  }
  const inputResults = await Promise.allSettled(
    plan.tunnel.map((url, index) =>
      fetchTunnelFile(
        url,
        `tagium-video-input-${index}`,
        request.sourceUrl,
        callbacks,
        signal,
        index,
        plan.tunnel.length,
      ),
    ),
  );
  const inputLeases = inputResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failedInput = inputResults.find((result) => result.status === "rejected");
  if (failedInput?.status === "rejected") {
    await Promise.allSettled(inputLeases.map((lease) => lease.release()));
    throw failedInput.reason;
  }

  try {
    const outputLease = await runLocalProcessingWorker(
      plan,
      inputLeases.map((lease) => lease.value),
      request.sourceUrl,
      callbacks,
      signal,
    );
    report(callbacks, { phase: "finalizing", progress: 1 });
    return fileDownloadResult(outputLease);
  } finally {
    await Promise.allSettled(inputLeases.map((lease) => lease.release()));
  }
};

const executePickerItem = async (
  request: CobaltVideoDownloadRequest,
  item: CobaltPickerItem,
  callbacks: VideoDownloadCallbacks | undefined,
  signal: AbortSignal,
): Promise<VideoFileDownloadResult> => {
  const fileLease = await fetchTunnelFile(
    item.url,
    pickerFilename(item),
    request.sourceUrl || item.url,
    callbacks,
    signal,
    0,
    1,
    pickerContentType(item),
  );
  report(callbacks, { phase: "finalizing", progress: 1 });
  return fileDownloadResult(fileLease);
};

const executePickerAudio = async (
  request: CobaltVideoDownloadRequest,
  url: string,
  filename: string | undefined,
  callbacks: VideoDownloadCallbacks | undefined,
  signal: AbortSignal,
): Promise<VideoFileDownloadResult> => {
  const fileLease = await fetchTunnelFile(
    url,
    filename ?? "tagium-audio",
    request.sourceUrl || url,
    callbacks,
    signal,
    0,
    1,
  );
  report(callbacks, { phase: "finalizing", progress: 1 });
  return fileDownloadResult(fileLease);
};

const startPickerResourceDownload = (
  request: CobaltVideoDownloadRequest,
  callbacks: VideoDownloadCallbacks | undefined,
  execute: (signal: AbortSignal) => Promise<VideoFileDownloadResult>,
): VideoDownloadTask<VideoFileDownloadResult> =>
  createTask(async (signal) => {
    try {
      return await cobaltDownloadScheduler.schedule(() => execute(signal), signal);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        throw new VideoDownloadError("tunnel", "download cancelled.", undefined, error);
      }
      if (error instanceof VideoDownloadError) throw error;
      throw new VideoDownloadError(
        "tunnel",
        errorText(error, "video download failed."),
        undefined,
        error,
      );
    }
  }, request.signal ?? callbacks?.signal);

const executeDownload = async (
  request: CobaltVideoDownloadRequest,
  callbacks: VideoDownloadCallbacks | undefined,
  signal: AbortSignal,
  allowPicker: boolean,
): Promise<VideoDownloadResult> => {
  const response = await fetchPlan(request, callbacks, signal);
  if (response.status === "error") {
    throw new VideoDownloadError("planning", response.error.code, response.error.code);
  }
  return executePlan(response, request, callbacks, signal, allowPicker);
};

export const resolveVideoDownload = async (
  request: CobaltVideoDownloadRequest,
  callbacks?: VideoDownloadCallbacks,
): Promise<CobaltDownloadPlan> => {
  const signal = request.signal ?? callbacks?.signal;
  const task = createTask(async (taskSignal) => {
    await cobaltDownloadScheduler.waitForAdmission({ signal: taskSignal });
    const response = await fetchPlan(request, callbacks, taskSignal);
    if (response.status === "error") {
      throw new VideoDownloadError("planning", response.error.code, response.error.code);
    }
    return response;
  }, signal);
  return task.promise;
};

export const startVideoDownload = (
  request: CobaltVideoDownloadRequest,
  callbacks?: VideoDownloadCallbacks,
): VideoDownloadTask<VideoDownloadResult> =>
  createTask(async (signal) => {
    try {
      await cobaltDownloadScheduler.waitForAdmission({ signal });
      return await cobaltDownloadScheduler.schedule(
        () => executeDownload(request, callbacks, signal, true),
        signal,
      );
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        throw new VideoDownloadError("planning", "download cancelled.", undefined, error);
      }
      if (error instanceof VideoDownloadError) throw error;
      throw new VideoDownloadError(
        "planning",
        errorText(error, "video download failed."),
        undefined,
        error,
      );
    }
  }, request.signal ?? callbacks?.signal);

export const downloadVideoPickerItem = (
  request: CobaltVideoDownloadRequest,
  item: CobaltPickerItem,
  callbacks?: VideoDownloadCallbacks,
): VideoDownloadTask<VideoFileDownloadResult> =>
  startPickerResourceDownload(request, callbacks, (signal) =>
    executePickerItem(request, item, callbacks, signal),
  );

export const downloadVideoFile = (
  request: CobaltVideoDownloadRequest,
  callbacks?: VideoDownloadCallbacks,
): VideoDownloadTask<VideoFileDownloadResult> => {
  const task = startVideoDownload(request, callbacks);
  return mapTask(task, (result) => {
    if (result.status !== "file") {
      throw new VideoDownloadError("planning", "choose an item before downloading.");
    }
    return result;
  });
};

export type VideoDownloadSelection = CobaltDownloadPlan | CobaltPickerItem;

const isPickerItemInput = (value: unknown): value is CobaltPickerItem => {
  if (!isRecord(value) || !("type" in value) || !("url" in value)) return false;
  return (
    (value.type === "photo" || value.type === "video" || value.type === "gif") &&
    typeof value.url === "string" &&
    value.url.length > 0
  );
};

/** Executes an already-resolved plan through the same guarded download path. */
export function executeVideoDownload(
  plan: CobaltDownloadPlan,
  callbacks?: VideoDownloadCallbacks,
): Promise<VideoDownloadResult>;
export function executeVideoDownload(
  item: CobaltPickerItem,
  callbacks?: VideoDownloadCallbacks,
): Promise<VideoDownloadResult>;
export async function executeVideoDownload(
  planOrPickerItem: VideoDownloadSelection,
  callbacks?: VideoDownloadCallbacks,
): Promise<VideoDownloadResult> {
  const task = createTask(async (signal) => {
    return cobaltDownloadScheduler.schedule(async () => {
      if (isPickerItemInput(planOrPickerItem)) {
        return executePickerItem(
          { sourceUrl: planOrPickerItem.url },
          planOrPickerItem,
          callbacks,
          signal,
        );
      }

      let response: CobaltDownloadResponse;
      try {
        response = await Effect.runPromise(decodeCobaltDownloadResponseEffect(planOrPickerItem));
      } catch (error) {
        throw new VideoDownloadError(
          "planning",
          "cobalt returned an invalid download plan.",
          undefined,
          error,
        );
      }
      if (response.status === "error") {
        throw new VideoDownloadError("planning", response.error.code, response.error.code);
      }

      return executePlan(response, { sourceUrl: "" }, callbacks, signal, true);
    }, signal);
  }, callbacks?.signal);

  return task.promise;
}
