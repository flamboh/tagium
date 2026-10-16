export interface ConcurrencyLimiter {
  run: <Value>(work: () => Promise<Value>, signal?: AbortSignal) => Promise<Value>;
}

/** Runs at most `maxConcurrent` pieces of work at once; the rest wait in arrival order. */
export const createConcurrencyLimiter = (maxConcurrent: number): ConcurrencyLimiter => {
  let active = 0;
  const pending: Array<() => void> = [];

  const release = () => {
    const next = pending.shift();

    if (next) {
      next();

      return;
    }

    active -= 1;
  };

  const reserve = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();

    if (active < maxConcurrent) {
      active += 1;

      return;
    }

    await new Promise<void>((resolve, reject) => {
      const resolveSlot = () => {
        signal?.removeEventListener("abort", onAbort);

        if (signal?.aborted) {
          release();
          reject(signal.reason);

          return;
        }

        resolve();
      };

      const onAbort = () => {
        const pendingIndex = pending.indexOf(resolveSlot);

        if (pendingIndex >= 0) {
          pending.splice(pendingIndex, 1);
        }

        reject(signal?.reason);
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      pending.push(resolveSlot);
    });
  };

  return {
    run: async (work, signal) => {
      await reserve(signal);

      try {
        return await work();
      } finally {
        release();
      }
    },
  };
};
