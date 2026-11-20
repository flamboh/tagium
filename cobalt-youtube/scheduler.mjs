import { Effect, Semaphore } from "effect";

const blockedErrors = new Set(["youtube.login", "fetch.rate"]);

const transientErrors = new Set(["fetch.fail"]);

export const createYouTubeResolver = (
  resolve,
  {
    spacingMs = 5_000,
    cooldownMs = 300_000,
    maxPending = 4,
    queueTimeoutMs = 20_000,
    attemptTimeoutMs = 20_000,
    now = Date.now,
  } = {},
) => {
  const semaphore = Semaphore.makeUnsafe(1);
  let pending = 0;
  let nextStart = 0;
  let blockedUntil = 0;
  let blockedError;
  const blockedVideos = new Map();

  const getBlock = (options) => {
    if (now() < blockedUntil) return { error: blockedError };
    const video = blockedVideos.get(options.id);

    if (video && now() < video.until) return { error: video.error };
  };

  return async (options) => {
    for (const [id, video] of blockedVideos) {
      if (now() >= video.until) blockedVideos.delete(id);
    }

    const blocked = getBlock(options);

    if (blocked) return blocked;

    if (pending >= maxPending) return { error: "capacity_exceeded" };
    pending += 1;
    const queuedAt = now();
    let started = false;

    const attempt = Effect.gen(function* () {
      const blocked = getBlock(options);

      if (blocked) return blocked;

      if (!started && now() - queuedAt >= queueTimeoutMs) return { error: "capacity_exceeded" };
      const delay = nextStart - now();

      if (delay > 0) yield* Effect.sleep(delay);

      if (!started && now() - queuedAt >= queueTimeoutMs) return { error: "capacity_exceeded" };
      started = true;
      nextStart = now() + spacingMs;

      const result = yield* Effect.tryPromise({
        try: (signal) => resolve({ ...options, signal }),
        catch: (error) => ({ error: error?.code === "fetch.rate" ? "fetch.rate" : "fetch.fail" }),
      }).pipe(
        Effect.timeout(attemptTimeoutMs),
        Effect.catch((error) => Effect.succeed(error?.error ? error : { error: "fetch.fail" })),
      );

      const response = { ...result };
      delete response.retry;
      delete response.cooldown;

      if (result.cooldown === "video" && options.id) {
        if (blockedVideos.size >= 64) blockedVideos.delete(blockedVideos.keys().next().value);
        blockedVideos.set(options.id, { error: response.error, until: now() + cooldownMs });
      } else if (blockedErrors.has(response.error)) {
        blockedError = response.error;
        blockedUntil = now() + cooldownMs;
      }

      return response;
    });

    try {
      return await Effect.runPromise(
        Effect.acquireUseRelease(
          semaphore.take(1).pipe(Effect.timeout(queueTimeoutMs)),
          () =>
            Effect.gen(function* () {
              const first = yield* attempt;

              if (!transientErrors.has(first.error)) return first;

              return yield* attempt;
            }),
          () => semaphore.release(1),
        ).pipe(
          Effect.timeout(queueTimeoutMs + attemptTimeoutMs * 2 + spacingMs),
          Effect.catch(() => Effect.succeed({ error: "capacity_exceeded" })),
        ),
      );
    } finally {
      pending -= 1;
    }
  };
};
