import { parseMediaLink, isSoundCloudHost } from "../../src/lib/media-link";

const SHORT_HOSTS = new Set(["on.soundcloud.com", "snd.sc"]);
const MAX_HOPS = 4;
const TIMEOUT_MS = 5_000;

export async function resolveSoundCloudShortLink(
  input: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
) {
  let current: URL;
  try {
    current = new URL(input);
  } catch {
    throw new Error("soundcloud.short.invalid");
  }
  if (
    current.protocol !== "https:" &&
    !(current.protocol === "http:" && current.hostname === "snd.sc")
  )
    throw new Error("soundcloud.short.invalid");
  if (current.protocol === "http:") current.protocol = "https:";
  if (!SHORT_HOSTS.has(current.hostname.toLowerCase())) throw new Error("soundcloud.short.invalid");
  const fetchImpl = options.fetch ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  if (options.signal?.aborted) controller.abort();
  const abort = () => controller.abort();
  if (options.signal) options.signal.addEventListener("abort", abort, { once: true });
  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const response = await fetchImpl(current, { redirect: "manual", signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || hop === MAX_HOPS) throw new Error("soundcloud.short.too_many_redirects");
        const next = new URL(location, current);
        if (next.protocol === "http:" && next.hostname.toLowerCase() === "snd.sc")
          next.protocol = "https:";
        const nextHost = next.hostname.toLowerCase();
        if (
          next.protocol !== "https:" ||
          next.username ||
          next.password ||
          next.port ||
          next.hash ||
          (!SHORT_HOSTS.has(nextHost) && !isSoundCloudHost(nextHost))
        )
          throw new Error("soundcloud.short.off_provider");
        current = next;
        continue;
      }
      if (!response.ok) throw new Error("soundcloud.short.unavailable");
      const parsed = parseMediaLink(current.toString());
      if (parsed.provider !== "soundcloud") throw new Error("soundcloud.short.unsupported");
      return parsed;
    }
    throw new Error("soundcloud.short.too_many_redirects");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
