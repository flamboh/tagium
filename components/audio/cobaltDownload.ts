import { decodeCobaltDownloadPlan, decodeCobaltLocalProcessingMessage } from "./cobaltAudioSchemas";

export type AudioDownloadBitrate = "320" | "256" | "128" | "96" | "64";

export type CobaltDownloadPlan =
  | {
      status: "tunnel";
      url: string;
      filename: string;
    }
  | {
      status: "local-processing";
      type: "audio";
      tunnel: string[];
      output: {
        type: string;
        filename: string;
        metadata?: Record<string, string | undefined>;
      };
      audio: {
        copy: boolean;
        format: string;
        bitrate: string;
        cover?: boolean;
        cropCover?: boolean;
      };
    };

export type CobaltAudioDownloadLifecycleEvent =
  | {
      type: "tunnel-budget-wait-started";
    }
  | {
      type: "tunnel-budget-wait-ended";
    };

export type CobaltAudioDownloadLifecycleCallback = (
  event: CobaltAudioDownloadLifecycleEvent,
) => void;

export interface CobaltAudioDownloadRequest {
  sourceUrl: string;
  audioBitrate: AudioDownloadBitrate;
  onLifecycle?: CobaltAudioDownloadLifecycleCallback;
  signal?: AbortSignal;
}

type LocalAudioProcessingRequest = {
  audioFile: File;
  audio: {
    copy: boolean;
    format: string;
    bitrate: string;
  };
  output: {
    type: string;
    format: string;
    metadata?: Record<string, string | undefined>;
  };
};

interface MP3TagPicture {
  format: string;
  type: number;
  description: string;
  data: number[];
}

interface MP3TagReader {
  read: () => void;
  save?: () => void;
  error?: string;
  buffer?: ArrayBuffer;
  tags: {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    track?: string;
    v2?: {
      APIC?: MP3TagPicture[];
      TCOM?: string;
      TCOP?: string;
      TLAN?: string;
      TPE2?: string;
    };
  };
}

const MAX_CONCURRENT_COBALT_DOWNLOADS = 4;
const COBALT_TUNNEL_START_INTERVAL_MS = 1_600;
let activeCobaltDownloads = 0;
const pendingCobaltDownloads: (() => void)[] = [];
let nextCobaltTunnelStartAt = 0;
let cobaltTunnelStartQueue = Promise.resolve();
let waitingCobaltTunnelStarts = 0;

const delay = async (milliseconds: number, signal?: AbortSignal) => {
  signal?.throwIfAborted();

  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };

    timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

const reserveCobaltDownloadSlot = async (signal?: AbortSignal) => {
  signal?.throwIfAborted();

  if (activeCobaltDownloads < MAX_CONCURRENT_COBALT_DOWNLOADS) {
    activeCobaltDownloads += 1;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const resolveSlot = () => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        releaseCobaltDownloadSlot();
        reject(signal.reason);
        return;
      }
      resolve();
    };
    const onAbort = () => {
      const pendingIndex = pendingCobaltDownloads.indexOf(resolveSlot);
      if (pendingIndex >= 0) {
        pendingCobaltDownloads.splice(pendingIndex, 1);
      }
      reject(signal?.reason);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    pendingCobaltDownloads.push(resolveSlot);
  });
};

const releaseCobaltDownloadSlot = () => {
  const next = pendingCobaltDownloads.shift();
  if (next) {
    next();
    return;
  }

  activeCobaltDownloads -= 1;
};

const withCobaltDownloadSlot = async <Value>(
  download: () => Promise<Value>,
  signal?: AbortSignal,
) => {
  await reserveCobaltDownloadSlot(signal);

  try {
    return await download();
  } finally {
    releaseCobaltDownloadSlot();
  }
};

const waitForCobaltTunnelStart = async (
  onLifecycle?: CobaltAudioDownloadLifecycleCallback,
  signal?: AbortSignal,
) => {
  signal?.throwIfAborted();

  let releaseQueue = () => {};
  const previousQueue = cobaltTunnelStartQueue;
  cobaltTunnelStartQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  let isWaitingForBudget = false;
  waitingCobaltTunnelStarts += 1;

  try {
    if (waitingCobaltTunnelStarts > 1 || nextCobaltTunnelStartAt > Date.now()) {
      isWaitingForBudget = true;
      onLifecycle?.({ type: "tunnel-budget-wait-started" });
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        signal?.removeEventListener("abort", onAbort);
        reject(signal?.reason);
      };

      previousQueue.then(
        () => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        (error) => {
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
      signal?.addEventListener("abort", onAbort, { once: true });
    });

    signal?.throwIfAborted();

    const waitMs = nextCobaltTunnelStartAt - Date.now();
    if (waitMs > 0) {
      if (!isWaitingForBudget) {
        onLifecycle?.({ type: "tunnel-budget-wait-started" });
        isWaitingForBudget = true;
      }

      await delay(waitMs, signal);
    }

    signal?.throwIfAborted();
    nextCobaltTunnelStartAt = Date.now() + COBALT_TUNNEL_START_INTERVAL_MS;
  } finally {
    waitingCobaltTunnelStarts -= 1;
    releaseQueue();
    if (isWaitingForBudget) {
      onLifecycle?.({ type: "tunnel-budget-wait-ended" });
    }
  }
};

const getStableLastModified = (sourceUrl: string) =>
  Array.from(sourceUrl).reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) % 2_147_483_647;
  }, 1);

const stripMetadataControlCharacters = (value: string) =>
  Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("");

const fetchTunnelFile = async (
  url: string,
  filename: string,
  lastModified: number,
  onLifecycle?: CobaltAudioDownloadLifecycleCallback,
  signal?: AbortSignal,
) => {
  await waitForCobaltTunnelStart(onLifecycle, signal);

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  let contentType = response.headers.get("Content-Type");
  if (!contentType) {
    contentType = "application/octet-stream";
  }
  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error("cobalt tunnel response was empty.");
  }

  return new File([blob], filename, {
    type: contentType,
    lastModified,
  });
};

const runLocalProcessingWorker = async (
  request: LocalAudioProcessingRequest,
  signal?: AbortSignal,
) =>
  new Promise<Blob>((resolve, reject) => {
    signal?.throwIfAborted();

    const worker = new Worker(new URL("./cobaltLocalProcessingWorker.js", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      worker.terminate();
      cleanup();
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.onmessage = (event: MessageEvent) => {
      let message;
      try {
        message = decodeCobaltLocalProcessingMessage(event.data).cobaltLocalProcessing;
      } catch {
        return;
      }

      if ("blob" in message) {
        worker.terminate();
        cleanup();
        resolve(message.blob);
        return;
      }

      if ("error" in message) {
        worker.terminate();
        cleanup();
        reject(new Error(message.error));
      }
    };

    worker.onerror = (error) => {
      worker.terminate();
      cleanup();
      reject(new Error(error.message));
    };

    worker.postMessage({
      cobaltLocalProcessing: request,
    });
  });

export const validateLocalAudioPlan = (
  plan: Extract<CobaltDownloadPlan, { status: "local-processing" }>,
) => {
  if (plan.type !== "audio") {
    throw new Error("cobalt local processing response was not audio.");
  }
  if (!plan.audio) {
    throw new Error("cobalt local processing response missing audio settings.");
  }
  if (plan.tunnel.length === 0) {
    throw new Error("cobalt local processing response missing audio tunnel.");
  }
  if (plan.tunnel.length > 2) {
    throw new Error("cobalt local processing response included unexpected tunnels.");
  }
  if (plan.audio.cover && plan.tunnel.length !== 2) {
    throw new Error("cobalt local processing response missing cover tunnel.");
  }
};

const processLocalAudio = async (
  plan: Extract<CobaltDownloadPlan, { status: "local-processing" }>,
  lastModified: number,
  onLifecycle?: CobaltAudioDownloadLifecycleCallback,
  signal?: AbortSignal,
) => {
  validateLocalAudioPlan(plan);

  const outputFormat = plan.output.filename.split(".").pop()?.toLowerCase();
  if (!outputFormat) {
    throw new Error("cobalt local processing response missing output format.");
  }

  const audioTunnel = plan.tunnel[0];
  if (!audioTunnel) {
    throw new Error("cobalt local processing response missing audio tunnel.");
  }

  let audioFile: File;
  let coverFile: File | undefined;
  const shouldPostTagAsMp3 = outputFormat === "mp3";
  const coverTunnel = shouldPostTagAsMp3 ? plan.tunnel[1] : undefined;
  const audioFilePromise = fetchTunnelFile(
    audioTunnel,
    "input-0",
    lastModified,
    onLifecycle,
    signal,
  );
  if (coverTunnel) {
    [audioFile, coverFile] = await Promise.all([
      audioFilePromise,
      fetchTunnelFile(coverTunnel, "input-1", lastModified, onLifecycle, signal),
    ]);
  } else {
    audioFile = await audioFilePromise;
  }

  const blob = await runLocalProcessingWorker(
    {
      audioFile,
      audio: {
        copy: plan.audio.copy,
        format: plan.audio.format,
        bitrate: plan.audio.bitrate,
      },
      output: {
        type: plan.output.type,
        format: outputFormat,
        metadata: plan.output.metadata,
      },
    },
    signal,
  );
  signal?.throwIfAborted();

  const file = new File([blob], plan.output.filename, {
    type: plan.output.type,
    lastModified,
  });

  signal?.throwIfAborted();
  if (!shouldPostTagAsMp3) {
    return file;
  }

  return await tagCobaltAudioFile(file, plan, coverFile, lastModified);
};

const tagCobaltAudioFile = async (
  file: File,
  plan: Extract<CobaltDownloadPlan, { status: "local-processing" }>,
  coverFile: File | undefined,
  lastModified: number,
) => {
  const MP3Tag = (await import("mp3tag.js")).default;
  const mp3tag = new MP3Tag(await file.arrayBuffer(), true) as unknown as MP3TagReader;
  mp3tag.read();

  if (mp3tag.error) {
    throw new Error(mp3tag.error);
  }

  applyCobaltAudioMetadata(mp3tag, plan.output.metadata);

  if (coverFile) {
    mp3tag.tags.v2 ??= {};
    mp3tag.tags.v2.APIC = [
      {
        format: coverFile.type,
        type: 3,
        description: "cover",
        data: Array.from(new Uint8Array(await coverFile.arrayBuffer())),
      },
    ];
  }

  mp3tag.save?.();
  if (mp3tag.error || !mp3tag.buffer) {
    throw new Error(mp3tag.error ?? "unable to save metadata");
  }

  return new File([new Uint8Array(mp3tag.buffer)], plan.output.filename, {
    type: file.type,
    lastModified,
  });
};

export const applyCobaltAudioMetadata = (
  mp3tag: Pick<MP3TagReader, "tags">,
  metadata: Record<string, string | undefined> | undefined,
) => {
  if (!metadata) {
    return;
  }

  if (metadata.title) {
    mp3tag.tags.title = stripMetadataControlCharacters(metadata.title);
  }
  if (metadata.artist) {
    mp3tag.tags.artist = stripMetadataControlCharacters(metadata.artist);
  }
  if (metadata.album) {
    mp3tag.tags.album = stripMetadataControlCharacters(metadata.album);
  }
  if (metadata.date) {
    mp3tag.tags.year = stripMetadataControlCharacters(metadata.date);
  }
  if (metadata.genre) {
    mp3tag.tags.genre = stripMetadataControlCharacters(metadata.genre);
  }
  if (metadata.track) {
    mp3tag.tags.track = stripMetadataControlCharacters(metadata.track);
  }

  const v2Frames = {
    album_artist: "TPE2",
    composer: "TCOM",
    copyright: "TCOP",
    sublanguage: "TLAN",
  } as const;

  for (const [metadataKey, frameName] of Object.entries(v2Frames)) {
    const value = metadata[metadataKey];
    if (value) {
      mp3tag.tags.v2 ??= {};
      mp3tag.tags.v2[frameName] = stripMetadataControlCharacters(value);
    }
  }
};

const runCobaltAudioDownload = async ({
  sourceUrl,
  audioBitrate,
  onLifecycle,
  signal,
}: CobaltAudioDownloadRequest) => {
  const response = await fetch("/api/cobalt/audio", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      url: sourceUrl,
      audioBitrate,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const plan = decodeCobaltDownloadPlan(await response.json()) as CobaltDownloadPlan;
  const lastModified = getStableLastModified(sourceUrl);

  if (plan.status === "local-processing") {
    return await processLocalAudio(plan, lastModified, onLifecycle, signal);
  }

  return await fetchTunnelFile(plan.url, plan.filename, lastModified, onLifecycle, signal);
};

export async function downloadCobaltAudio(request: CobaltAudioDownloadRequest) {
  return await withCobaltDownloadSlot(() => runCobaltAudioDownload(request), request.signal);
}
