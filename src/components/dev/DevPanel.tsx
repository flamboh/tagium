import { useCallback, useEffect, useRef, useState } from "react";
import { Schema } from "effect";
import {
  Alert02Icon,
  FlashIcon,
  Notification03Icon,
  PreferenceHorizontalIcon,
  RotateLeft02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TagiumAppId } from "@/runtime/resolveApp";
import { devToastKinds, spawnDevToast } from "./devToast";

type AudioFault = "rate-limit" | "capacity" | "timeout" | "unreachable" | "malformed";
type TunnelFault = "rate-limit" | "capacity" | "timeout" | "empty-body";

const devConfigSchema = Schema.Struct({
  enabled: Schema.Boolean,
  deployEnv: Schema.Literals(["local", "preview", "production"]),
  detectedFrom: Schema.String,
  productionBranch: Schema.String,
  rateLimit: Schema.Struct({
    windowMs: Schema.Number,
    maxRequests: Schema.Number,
    bucketCount: Schema.Number,
    client: Schema.Struct({
      key: Schema.String,
      count: Schema.Number,
      remaining: Schema.Number,
      resetAt: Schema.optionalKey(Schema.Number),
    }),
  }),
  faults: Schema.Struct({
    nextAudioFault: Schema.optionalKey(
      Schema.Literals(["rate-limit", "capacity", "timeout", "unreachable", "malformed"]),
    ),
    nextTunnelFault: Schema.optionalKey(
      Schema.Literals(["rate-limit", "capacity", "timeout", "empty-body"]),
    ),
  }),
});
type DevConfig = Schema.Schema.Type<typeof devConfigSchema>;
type DevConfigPatch =
  | { rateLimit: { windowMs: number; maxRequests: number } }
  | { resetRateLimitBuckets: true };

const decodeDevConfig = Schema.decodeUnknownSync(devConfigSchema);

const audioFaults: Array<{ value: AudioFault; label: string }> = [
  { value: "rate-limit", label: "429" },
  { value: "capacity", label: "capacity" },
  { value: "timeout", label: "timeout" },
  { value: "unreachable", label: "offline" },
  { value: "malformed", label: "bad json" },
];

const tunnelFaults: Array<{ value: TunnelFault; label: string }> = [
  { value: "rate-limit", label: "429" },
  { value: "capacity", label: "capacity" },
  { value: "timeout", label: "timeout" },
  { value: "empty-body", label: "empty" },
];

const readDevConfig = async (signal: AbortSignal) => {
  const response = await fetch("/api/dev/config", { signal });
  if (!response.ok) return null;
  return decodeDevConfig(await response.json());
};

const formatReset = (resetAt: number | undefined) => {
  if (!resetAt) return "none";

  const seconds = Math.max(Math.ceil((resetAt - Date.now()) / 1_000), 0);
  return `${seconds}s`;
};

export function DevPanel({ appId }: { appId: TagiumAppId }) {
  const [config, setConfig] = useState<DevConfig | null>(null);
  const [windowMs, setWindowMs] = useState("60000");
  const [maxRequests, setMaxRequests] = useState("60");
  const [busy, setBusy] = useState(false);
  const activeConfigRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    activeConfigRequest.current?.abort();
    const request = new AbortController();
    activeConfigRequest.current = request;

    try {
      const nextConfig = await readDevConfig(request.signal);
      if (request.signal.aborted || activeConfigRequest.current !== request) return;

      setConfig(nextConfig);
      if (nextConfig) {
        setWindowMs(String(nextConfig.rateLimit.windowMs));
        setMaxRequests(String(nextConfig.rateLimit.maxRequests));
      }
    } catch {
      // This panel is optional; retain the last config if its dev-only endpoint is unavailable.
    } finally {
      if (activeConfigRequest.current === request) activeConfigRequest.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      activeConfigRequest.current?.abort();
      activeConfigRequest.current = null;
    };
  }, [refresh]);

  if (!config?.enabled) return null;

  const patchConfig = async (body: DevConfigPatch) => {
    setBusy(true);
    try {
      const response = await fetch("/api/dev/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        const nextConfig = decodeDevConfig(await response.json());
        setConfig(nextConfig);
        setWindowMs(String(nextConfig.rateLimit.windowMs));
        setMaxRequests(String(nextConfig.rateLimit.maxRequests));
      }
    } finally {
      setBusy(false);
    }
  };

  const setFault = async (target: "audio" | "tunnel", fault: AudioFault | TunnelFault | null) => {
    setBusy(true);
    try {
      const response = await fetch("/api/dev/fault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, fault }),
      });
      if (response.ok) {
        setConfig(decodeDevConfig(await response.json()));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed right-4 bottom-4 z-50">
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="icon"
                className="size-10 border border-foreground/15 bg-foreground text-background shadow-lg hover:bg-foreground/90"
                aria-label="open dev panel"
              >
                <HugeiconsIcon icon={PreferenceHorizontalIcon} strokeWidth={2} />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="left">dev panel</TooltipContent>
        </Tooltip>
        <PopoverContent
          align="end"
          side="top"
          className="w-[min(24rem,calc(100vw-2rem))] border-foreground/10 bg-background/95 p-0 shadow-xl backdrop-blur"
        >
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold leading-tight">dev panel</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {config.deployEnv} / {config.detectedFrom}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button asChild size="sm" variant="ghost">
                  <a href={appId === "tagium" ? "/?app=tagium-save" : "/"}>
                    {appId === "tagium" ? "open tagium save" : "open tagium"}
                  </a>
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  onClick={() => void refresh()}
                  disabled={busy}
                  aria-label="refresh dev config"
                >
                  <HugeiconsIcon icon={RotateLeft02Icon} strokeWidth={2} />
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-4">
            <section className="grid gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <HugeiconsIcon icon={FlashIcon} strokeWidth={2} className="size-3.5" />
                rate limit
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Label className="grid gap-1.5 text-xs">
                  window ms
                  <Input
                    type="number"
                    min={1000}
                    max={600000}
                    step={1000}
                    value={windowMs}
                    onChange={(event) => setWindowMs(event.target.value)}
                  />
                </Label>
                <Label className="grid gap-1.5 text-xs">
                  max
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={maxRequests}
                    onChange={(event) => setMaxRequests(event.target.value)}
                  />
                </Label>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    void patchConfig({
                      rateLimit: {
                        windowMs: Number(windowMs),
                        maxRequests: Number(maxRequests),
                      },
                    })
                  }
                  disabled={busy}
                >
                  apply
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void patchConfig({ resetRateLimitBuckets: true })}
                  disabled={busy}
                >
                  reset buckets
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-md border border-border bg-muted/40 p-2 text-xs">
                <div>
                  <p className="text-muted-foreground">count</p>
                  <p className="font-mono">{config.rateLimit.client.count}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">left</p>
                  <p className="font-mono">{config.rateLimit.client.remaining}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">reset</p>
                  <p className="font-mono">{formatReset(config.rateLimit.client.resetAt)}</p>
                </div>
              </div>
            </section>

            {appId === "tagium" && (
              <section className="grid gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3.5" />
                  next audio
                </div>
                <div className="flex flex-wrap gap-2">
                  {audioFaults.map((fault) => (
                    <Button
                      key={fault.value}
                      type="button"
                      size="sm"
                      variant={config.faults.nextAudioFault === fault.value ? "default" : "outline"}
                      onClick={() => void setFault("audio", fault.value)}
                      disabled={busy}
                    >
                      {fault.label}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void setFault("audio", null)}
                    disabled={busy}
                  >
                    clear
                  </Button>
                </div>
              </section>
            )}

            <section className="grid gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3.5" />
                next tunnel
              </div>
              <div className="flex flex-wrap gap-2">
                {tunnelFaults.map((fault) => (
                  <Button
                    key={fault.value}
                    type="button"
                    size="sm"
                    variant={config.faults.nextTunnelFault === fault.value ? "default" : "outline"}
                    onClick={() => void setFault("tunnel", fault.value)}
                    disabled={busy}
                  >
                    {fault.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void setFault("tunnel", null)}
                  disabled={busy}
                >
                  clear
                </Button>
              </div>
            </section>

            {appId === "tagium" && (
              <section className="grid gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <HugeiconsIcon icon={Notification03Icon} strokeWidth={2} className="size-3.5" />
                  toasts
                </div>
                <div className="flex flex-wrap gap-2">
                  {devToastKinds.map((kind) => (
                    <Button
                      key={kind}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => spawnDevToast(kind)}
                    >
                      {kind}
                    </Button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
