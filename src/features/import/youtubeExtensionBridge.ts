import {
  EXTENSION_CHANNEL,
  JOB_TIMEOUT_MS,
  MAX_AUDIO_BYTES,
  isReply,
  type ExtensionRequest,
  type ExtensionReply,
} from "@/shared/youtube-extension/protocol";

let snapshot = { available: false, enabled: false, notice: "" };

const listeners = new Set<() => void>();

export const extensionState = {
  subscribe: (listener: () => void) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => snapshot,
};

export const updateExtensionState = (patch: Partial<typeof snapshot>) => {
  snapshot = { ...snapshot, ...patch };

  for (const listener of listeners) listener();
};

const send = (payload: ExtensionRequest) =>
  window.postMessage({ channel: EXTENSION_CHANNEL, direction: "app", payload }, location.origin);

export class ExtensionCanceledError extends Error {}

const exchange = <T>(
  request: ExtensionRequest,
  timeout: number,
  receive: (message: ExtensionReply) => T | undefined,
  signal?: AbortSignal,
) =>
  new Promise<T>((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);

      if (error) {
        send({ type: "cancel", id: request.id });
        reject(error);
      } else resolve(result!);
    };

    const onAbort = () => finish(new ExtensionCanceledError("extension download canceled."));

    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== window ||
        event.origin !== location.origin ||
        event.data?.channel !== EXTENSION_CHANNEL ||
        event.data.direction !== "extension" ||
        !isReply(event.data.payload) ||
        event.data.payload.id !== request.id
      )
        return;
      const message = event.data.payload;

      if (message.type === "error") {
        finish(
          message.canceled
            ? new ExtensionCanceledError(message.message)
            : new Error(message.message),
        );

        return;
      }

      try {
        const result = receive(message);

        if (result !== undefined) finish(undefined, result);
      } catch {
        finish(new Error("the extension returned invalid or incomplete audio."));
      }
    };

    const timer = setTimeout(
      () => finish(new Error("extension did not respond. reconnect or use the server.")),
      timeout,
    );

    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });

    if (signal?.aborted) onAbort();
    else send(request);
  });

export const detectYouTubeExtension = async () => {
  try {
    await exchange({ type: "ping", id: crypto.randomUUID() }, 1500, (message) =>
      message.type === "ready" ? true : undefined,
    );
    updateExtensionState({ available: true });

    return true;
  } catch {
    updateExtensionState({ available: false, enabled: false });

    return false;
  }
};

export const acquireExtensionAudio = (videoId: string, signal?: AbortSignal) => {
  const id = crypto.randomUUID();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  let sequence = 0;

  return exchange(
    { type: "start", id, videoId },
    JOB_TIMEOUT_MS,
    (message) => {
      if (message.type === "chunk") {
        if (message.sequence !== sequence) throw new Error("invalid sequence");
        const chunk = Uint8Array.from(atob(message.data), (character) => character.charCodeAt(0));
        bytes += chunk.length;

        if (!chunk.length || bytes > MAX_AUDIO_BYTES) throw new Error("invalid size");
        chunks.push(chunk);
        send({ type: "ack", id, sequence });
        sequence += 1;
      } else if (message.type === "complete") {
        if (message.bytes !== bytes) throw new Error("incomplete transfer");

        return {
          file: new File(chunks, "input-0", { type: message.mime }),
          title: message.title,
          artist: message.artist,
        };
      }

      return undefined;
    },
    signal,
  );
};
