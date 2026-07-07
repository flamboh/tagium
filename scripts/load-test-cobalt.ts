/*
 * Load-tests a Cobalt Fly Machine directly, bypassing the Tagium API layer, to find where a
 * single Machine's concurrency ceiling breaks.
 *
 * SAFETY: point --target at a disposable clone of the Cobalt app, never at production
 * (tagium-cobalt.fly.dev). Repeated concurrent hits to real YouTube/SoundCloud URLs risk
 * getting the Machine's IP rate-limited or flagged by the source site, and running this
 * against the Machine real users depend on will degrade the app for them.
 *
 *   flyctl apps create tagium-cobalt-loadtest
 *   flyctl deploy --config fly.cobalt.toml --app tagium-cobalt-loadtest
 *   bun run scripts/load-test-cobalt.ts --target https://tagium-cobalt-loadtest.fly.dev
 *   flyctl apps destroy tagium-cobalt-loadtest   # when you're done
 *
 * While a wave is running, watch `flyctl machine status <id> -a tagium-cobalt-loadtest`
 * or the Fly dashboard metrics for CPU/mem, and correlate spikes with when latency/error
 * rate climbs below.
 *
 * Usage:
 *   bun run scripts/load-test-cobalt.ts [options]
 *
 * Options:
 *   --target <url>            Cobalt origin to hit (required).
 *   --url <url,url,...>       Source URLs to request, cycled across requests. Takes
 *                             precedence over --urls-file when both are given.
 *   --urls-file <path>        Newline-separated source URLs (# comments/blank lines
 *                             ignored). Defaults to scripts/load-test-urls.txt, a curated
 *                             list of stable, openly-licensed content chosen to be safe
 *                             to hit repeatedly. Add more lines there as you find them.
 *   --waves <n,n,...>         Concurrency levels to step through. Default: 1,2,4,8,16,24.
 *   --requests-per-wave <n>   Requests fired per wave. Default: 12.
 *   --max-requests <n>        Hard cap on total requests across the whole run. Default: 400.
 *                             Refuses to run past this unless --force is also passed.
 *   --force                   Bypass the --max-requests guard.
 *   --abort-error-rate <0-1>  Stop escalating waves once a wave's error rate exceeds this.
 *                             Default: 0.4.
 *   --bitrate <kbps>          Requested audio bitrate. Default: 128.
 *   --api-key <key>           Cobalt API key, if the instance requires one. Falls back to
 *                             the COBALT_API_KEY env var.
 */
import { readFileSync } from "node:fs";
import { argv, env, exit } from "node:process";
import { fileURLToPath } from "node:url";

// Last-resort fallback if scripts/load-test-urls.txt is missing or unreadable.
const FALLBACK_URLS = ["https://www.youtube.com/watch?v=YE7VzlLtp-4"];
const DEFAULT_URLS_FILE = fileURLToPath(new URL("./load-test-urls.txt", import.meta.url));
const REQUEST_TIMEOUT_MS = 120_000;

type CobaltPlan =
  | { status: "error"; error: { code: string } }
  | { status: "picker"; audio?: string; audioFilename?: string }
  | { status: "redirect"; url: string; filename: string }
  | { status: "tunnel"; url: string; filename: string }
  | { status: "local-processing"; tunnel: string[] };

interface DownloadResult {
  ok: boolean;
  status?: number;
  errorCode?: string;
  resolveMs: number;
  streamMs?: number;
  bytes?: number;
}

interface WaveSummary {
  concurrency: number;
  total: number;
  succeeded: number;
  failed: number;
  errorCodes: Map<string, number>;
  wallMs: number;
  totalBytes: number;
  resolveLatenciesMs: number[];
  streamLatenciesMs: number[];
}

interface CliOptions {
  target: string;
  urls: string[];
  waves: number[];
  requestsPerWave: number;
  maxRequests: number;
  force: boolean;
  abortErrorRate: number;
  bitrate: string;
  apiKey: string | undefined;
}

const readUrlsFile = (path: string): string[] =>
  readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

const resolveUrls = (flags: Map<string, string>): string[] => {
  const inlineUrls = flags.get("url");
  if (inlineUrls) {
    return inlineUrls.split(",").map((url) => url.trim());
  }

  const urlsFilePath = flags.get("urls-file") ?? DEFAULT_URLS_FILE;
  try {
    const urlsFromFile = readUrlsFile(urlsFilePath);
    if (urlsFromFile.length > 0) {
      return urlsFromFile;
    }
  } catch {
    // Fall through to the embedded fallback below.
  }

  return FALLBACK_URLS;
};

const parseArgs = (argv: string[]): CliOptions => {
  const flags = new Map<string, string>();
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg?.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`Missing value for --${key}.`);
      }
      flags.set(key, value);
      index += 1;
    }
  }

  const target = flags.get("target");
  if (!target) {
    throw new Error("Missing required --target <cobalt-origin-url>.");
  }

  return {
    target,
    urls: resolveUrls(flags),
    waves: (flags.get("waves") ?? "1,2,4,8,16,24").split(",").map((value) => Number(value.trim())),
    requestsPerWave: Number(flags.get("requests-per-wave") ?? "12"),
    maxRequests: Number(flags.get("max-requests") ?? "400"),
    force,
    abortErrorRate: Number(flags.get("abort-error-rate") ?? "0.4"),
    bitrate: flags.get("bitrate") ?? "128",
    apiKey: flags.get("api-key") ?? env.COBALT_API_KEY,
  };
};

// Real downloads fetch every tunnel Cobalt returns concurrently (audio + cover art when
// present) - see components/audio/localAudioProcessor.ts's Effect.all([audio, cover]).
// A single "download" therefore usually means 2 concurrent /tunnel requests, not 1.
const pickTunnelUrls = (plan: CobaltPlan): string[] => {
  switch (plan.status) {
    case "local-processing":
      return plan.tunnel;
    case "tunnel":
    case "redirect":
      return [plan.url];
    case "picker":
      return plan.audio ? [plan.audio] : [];
    default:
      return [];
  }
};

const fetchTunnel = async (url: string) => {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok || !response.body) {
      return { ok: false as const, status: response.status, bytes: 0 };
    }

    let bytes = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      bytes += value.byteLength;
    }

    return { ok: true as const, bytes };
  } catch (error) {
    return { ok: false as const, errorCode: describeError(error), bytes: 0 };
  }
};

const describeError = (error: unknown) => {
  if (error instanceof Error) {
    return error.name === "TimeoutError" ? "timeout" : error.message;
  }
  return "unknown-error";
};

const performOneDownload = async (
  target: string,
  sourceUrl: string,
  bitrate: string,
  apiKey: string | undefined,
): Promise<DownloadResult> => {
  const resolveStart = performance.now();
  let response: Response;

  try {
    response = await fetch(new URL("/", target), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Api-Key ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        url: sourceUrl,
        downloadMode: "audio",
        audioFormat: "mp3",
        audioBitrate: bitrate,
        alwaysProxy: true,
        localProcessing: "forced",
        filenameStyle: "pretty",
        youtubeHLS: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      errorCode: describeError(error),
      resolveMs: performance.now() - resolveStart,
    };
  }

  const resolveMs = performance.now() - resolveStart;

  if (!response.ok) {
    return { ok: false, status: response.status, resolveMs };
  }

  let plan: CobaltPlan;
  try {
    plan = (await response.json()) as CobaltPlan;
  } catch {
    return { ok: false, errorCode: "invalid-json", resolveMs };
  }

  if (plan.status === "error") {
    return { ok: false, errorCode: plan.error.code, resolveMs };
  }

  const tunnelUrls = pickTunnelUrls(plan);
  if (tunnelUrls.length === 0) {
    return {
      ok: false,
      errorCode: `unsupported-status:${plan.status}`,
      resolveMs,
    };
  }

  const streamStart = performance.now();
  const tunnelResults = await Promise.all(tunnelUrls.map((url) => fetchTunnel(url)));
  const streamMs = performance.now() - streamStart;
  const failedTunnel = tunnelResults.find((result) => !result.ok);
  if (failedTunnel && !failedTunnel.ok) {
    return {
      ok: false,
      status: failedTunnel.status,
      errorCode: failedTunnel.errorCode,
      resolveMs,
      streamMs,
    };
  }

  return {
    ok: true,
    resolveMs,
    streamMs,
    bytes: tunnelResults.reduce((sum, result) => sum + result.bytes, 0),
  };
};

const runWave = async (options: CliOptions, concurrency: number): Promise<WaveSummary> => {
  const summary: WaveSummary = {
    concurrency,
    total: 0,
    succeeded: 0,
    failed: 0,
    errorCodes: new Map(),
    wallMs: 0,
    totalBytes: 0,
    resolveLatenciesMs: [],
    streamLatenciesMs: [],
  };

  let dispatched = 0;
  const startedAt = performance.now();

  const worker = async () => {
    while (dispatched < options.requestsPerWave) {
      dispatched += 1;
      const sourceUrl = options.urls[(dispatched - 1) % options.urls.length]!;
      const result = await performOneDownload(
        options.target,
        sourceUrl,
        options.bitrate,
        options.apiKey,
      );

      summary.total += 1;
      summary.resolveLatenciesMs.push(result.resolveMs);
      if (result.streamMs !== undefined) {
        summary.streamLatenciesMs.push(result.streamMs);
      }

      if (result.ok) {
        summary.succeeded += 1;
        summary.totalBytes += result.bytes ?? 0;
      } else {
        summary.failed += 1;
        const key = result.errorCode ?? `http-${result.status ?? "unknown"}`;
        summary.errorCodes.set(key, (summary.errorCodes.get(key) ?? 0) + 1);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  summary.wallMs = performance.now() - startedAt;
  return summary;
};

const percentile = (values: number[], fraction: number) => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index]!;
};

const formatMs = (value: number) => `${value.toFixed(0)}ms`;
const formatMB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

const printWaveSummary = (summary: WaveSummary) => {
  const errorRate = summary.total === 0 ? 0 : summary.failed / summary.total;
  console.log(
    [
      `concurrency=${summary.concurrency}`,
      `total=${summary.total}`,
      `ok=${summary.succeeded}`,
      `failed=${summary.failed}`,
      `errorRate=${(errorRate * 100).toFixed(0)}%`,
      `wall=${formatMs(summary.wallMs)}`,
      `data=${formatMB(summary.totalBytes)}`,
    ].join("  "),
  );
  console.log(
    [
      `  resolve p50=${formatMs(percentile(summary.resolveLatenciesMs, 0.5))}`,
      `p95=${formatMs(percentile(summary.resolveLatenciesMs, 0.95))}`,
      `max=${formatMs(percentile(summary.resolveLatenciesMs, 1))}`,
    ].join("  "),
  );
  console.log(
    [
      `  stream  p50=${formatMs(percentile(summary.streamLatenciesMs, 0.5))}`,
      `p95=${formatMs(percentile(summary.streamLatenciesMs, 0.95))}`,
      `max=${formatMs(percentile(summary.streamLatenciesMs, 1))}`,
    ].join("  "),
  );
  if (summary.errorCodes.size > 0) {
    const breakdown = Array.from(summary.errorCodes.entries())
      .map(([code, count]) => `${code}=${count}`)
      .join(", ");
    console.log(`  errors: ${breakdown}`);
  }
  console.log("");
};

const main = async () => {
  const options = parseArgs(argv.slice(2));
  const totalPlannedRequests = options.waves.length * options.requestsPerWave;

  if (totalPlannedRequests > options.maxRequests && !options.force) {
    throw new Error(
      `Planned ${totalPlannedRequests} requests exceeds --max-requests ${options.maxRequests}. ` +
        "Lower --waves/--requests-per-wave or pass --force to proceed.",
    );
  }

  console.log(`Target: ${options.target}`);
  console.log(`URLs: ${options.urls.join(", ")}`);
  console.log(`Waves (concurrency): ${options.waves.join(", ")}`);
  console.log(`Requests per wave: ${options.requestsPerWave}`);
  console.log("");

  for (const concurrency of options.waves) {
    const summary = await runWave(options, concurrency);
    printWaveSummary(summary);

    const errorRate = summary.total === 0 ? 0 : summary.failed / summary.total;
    if (errorRate > options.abortErrorRate) {
      console.log(
        `Error rate ${(errorRate * 100).toFixed(0)}% exceeded --abort-error-rate ` +
          `${(options.abortErrorRate * 100).toFixed(0)}% at concurrency=${concurrency}. ` +
          "Stopping before escalating further — this concurrency is at or past the breaking point.",
      );
      break;
    }
  }

  console.log(
    "Done. Remember to `flyctl apps destroy` the disposable Cobalt app if you created one.",
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  exit(1);
});
