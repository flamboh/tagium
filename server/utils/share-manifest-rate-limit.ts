export type ShareRateLimitBinding = {
  limit: (input: { key: string }) => Promise<{ success: boolean }>;
};

/** Rate-limit state is held by Cloudflare only; raw addresses are never persisted. */
export const admitShareRequest = async (
  request: Request,
  limiter: ShareRateLimitBinding | undefined,
): Promise<boolean> => {
  if (!limiter) return true; // local development and tests have no binding.
  try {
    return (
      await limiter.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown-client" })
    ).success;
  } catch {
    return false;
  }
};
