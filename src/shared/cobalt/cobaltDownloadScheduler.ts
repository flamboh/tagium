import {
  createDownloadAdmissionWindow,
  DEFAULT_DOWNLOAD_ADMISSION_COST,
} from "@/shared/cobalt/downloadAdmissionWindow";

export type CobaltTunnelWaitCallback = (waiting: boolean) => void;

export interface CobaltDownloadScheduler {
  schedule: <Value>(work: () => Promise<Value>, signal?: AbortSignal) => Promise<Value>;
  waitForAdmission: (options?: { cost?: number; signal?: AbortSignal }) => Promise<void>;
  waitForTunnelStart: (options?: {
    signal?: AbortSignal;
    onWaitChange?: CobaltTunnelWaitCallback;
  }) => Promise<void>;
}

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

/**
 * Coordinates all browser-side Cobalt work. Downloads wait for a shared slot,
 * and tunnel starts are serialized so queued work slows down instead of failing.
 */
export const createCobaltDownloadScheduler = ({
  maxConcurrentDownloads = 4,
  tunnelStartIntervalMs = 1_600,
}: {
  maxConcurrentDownloads?: number;
  tunnelStartIntervalMs?: number;
} = {}): CobaltDownloadScheduler => {
  let activeDownloads = 0;
  const pendingDownloads: Array<() => void> = [];
  let nextTunnelStartAt = 0;
  let tunnelStartQueue = Promise.resolve();
  let waitingTunnelStarts = 0;
  const admission = createDownloadAdmissionWindow();

  const releaseDownloadSlot = () => {
    const next = pendingDownloads.shift();
    if (next) {
      next();
      return;
    }

    activeDownloads -= 1;
  };

  const reserveDownloadSlot = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();

    if (activeDownloads < maxConcurrentDownloads) {
      activeDownloads += 1;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const resolveSlot = () => {
        signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) {
          releaseDownloadSlot();
          reject(signal.reason);
          return;
        }
        resolve();
      };
      const onAbort = () => {
        const pendingIndex = pendingDownloads.indexOf(resolveSlot);
        if (pendingIndex >= 0) {
          pendingDownloads.splice(pendingIndex, 1);
        }
        reject(signal?.reason);
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      pendingDownloads.push(resolveSlot);
    });
  };

  const schedule = async <Value>(work: () => Promise<Value>, signal?: AbortSignal) => {
    await reserveDownloadSlot(signal);
    try {
      return await work();
    } finally {
      releaseDownloadSlot();
    }
  };

  const waitForAdmission: CobaltDownloadScheduler["waitForAdmission"] = async ({
    cost = DEFAULT_DOWNLOAD_ADMISSION_COST,
    signal,
  } = {}) => {
    while (true) {
      signal?.throwIfAborted();
      const reservation = admission.reserve(cost, Date.now());
      if (reservation.status === "admitted") return;
      await delay(reservation.waitMs, signal);
    }
  };

  const waitForTunnelStart: CobaltDownloadScheduler["waitForTunnelStart"] = async ({
    signal,
    onWaitChange,
  } = {}) => {
    signal?.throwIfAborted();

    let releaseQueue = () => {};
    const previousQueue = tunnelStartQueue;
    tunnelStartQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    let isWaiting = false;
    waitingTunnelStarts += 1;

    try {
      if (waitingTunnelStarts > 1 || nextTunnelStartAt > Date.now()) {
        isWaiting = true;
        onWaitChange?.(true);
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
      const waitMs = nextTunnelStartAt - Date.now();
      if (waitMs > 0) {
        if (!isWaiting) {
          isWaiting = true;
          onWaitChange?.(true);
        }
        await delay(waitMs, signal);
      }

      signal?.throwIfAborted();
      nextTunnelStartAt = Date.now() + tunnelStartIntervalMs;
    } finally {
      waitingTunnelStarts -= 1;
      releaseQueue();
      if (isWaiting) onWaitChange?.(false);
    }
  };

  return { schedule, waitForAdmission, waitForTunnelStart };
};

export let cobaltDownloadScheduler = createCobaltDownloadScheduler();

/** Replaces browser-wide scheduler state between isolated unit tests. */
export const resetCobaltDownloadSchedulerForTests = () => {
  cobaltDownloadScheduler = createCobaltDownloadScheduler();
};
