import type {
  CobaltBehavior,
  MediaScenario,
  PostAsset,
  PostScenario,
  RateLimitRule,
  Scenario,
  Sequence,
  TunnelBehavior,
  UpstreamCall,
} from "./protocol.ts";

const HANG_LIMIT_MS = 10 * 60_000;

type Owned<T> = { value: T; owner: string };
type Cursor = { cobalt: number; tunnel: number };
export type CallFilter = {
  owner?: string;
  includeUnowned?: boolean;
  since?: number;
  unexpected?: boolean;
};
export type Tunnel = {
  key: string;
  part: "audio" | "cover" | "video" | "post";
  machineId: string;
  asset?: PostAsset;
  filename?: string;
};

const pick = <T>(sequence: Sequence<T>, index: number): T => {
  if (!Array.isArray(sequence)) return sequence as T;
  return sequence[Math.min(index, sequence.length - 1)]!;
};

export class ScenarioConflictError extends Error {}

export const createRegistry = () => {
  const scenarios = new Map<string, Owned<Scenario>>();
  const cobaltOverrides = new Map<string, Owned<Sequence<CobaltBehavior>>>();
  const tunnelOverrides = new Map<string, Owned<Sequence<TunnelBehavior>>>();
  const cursors = new Map<string, Cursor>();
  const soundcloudIds = new Map<number, string>();
  const tunnels = new Map<string, Tunnel>();
  const hangs = new Map<string, Set<() => void>>();
  const rateLimits = new Map<string, Owned<{ rule: RateLimitRule; used: number }>>();
  const releasedOwners = new Map<string, string>();
  const releasedTunnels = new Map<string, string>();
  const calls: UpstreamCall[] = [];

  const cursor = (key: string) => {
    let value = cursors.get(key);
    if (!value) {
      value = { cobalt: 0, tunnel: 0 };
      cursors.set(key, value);
    }
    return value;
  };

  const claim = <T>(map: Map<string, Owned<T>>, key: string, owner: string, value: T) => {
    const existing = map.get(key);
    if (existing && existing.owner !== owner) {
      throw new ScenarioConflictError(`${key} is already registered by another test`);
    }
    map.set(key, { value, owner });
  };

  const rateLimitKey = (binding: string, key: string) => `${binding}\n${key}`;

  return {
    register(owner: string, entries: readonly Scenario[]) {
      for (const scenario of entries) {
        claim(scenarios, scenario.key, owner, scenario);
        if (scenario.type === "media" && scenario.soundcloudId !== undefined) {
          soundcloudIds.set(scenario.soundcloudId, scenario.key);
        }
      }
    },
    overrideCobalt(owner: string, key: string, behavior: Sequence<CobaltBehavior>) {
      claim(cobaltOverrides, key, owner, behavior);
      cursor(key).cobalt = 0;
    },
    overrideTunnel(owner: string, key: string, behavior: Sequence<TunnelBehavior>) {
      claim(tunnelOverrides, key, owner, behavior);
      cursor(key).tunnel = 0;
    },
    limitRate(owner: string, rule: RateLimitRule) {
      claim(rateLimits, rateLimitKey(rule.binding, rule.key), owner, { rule, used: 0 });
    },
    release(owner: string) {
      for (const map of [scenarios, cobaltOverrides, tunnelOverrides, rateLimits] as const) {
        for (const [key, entry] of map) {
          if (entry.owner !== owner) continue;
          releasedOwners.set(key, owner);
          map.delete(key);
          cursors.delete(key);
          for (const resolve of hangs.get(key) ?? []) resolve();
          hangs.delete(key);
        }
      }
      for (const [id, key] of soundcloudIds) if (!scenarios.has(key)) soundcloudIds.delete(id);
      for (const [id, tunnel] of tunnels) {
        if (scenarios.has(tunnel.key)) continue;
        releasedTunnels.set(id, tunnel.key);
        tunnels.delete(id);
      }
    },
    get(key: string | null) {
      return key ? scenarios.get(key)?.value : undefined;
    },
    media(key: string | null): MediaScenario | undefined {
      const scenario = key ? scenarios.get(key)?.value : undefined;
      return scenario?.type === "media" ? scenario : undefined;
    },
    post(key: string | null): PostScenario | undefined {
      const scenario = key ? scenarios.get(key)?.value : undefined;
      return scenario?.type === "post" ? scenario : undefined;
    },
    mediaBySoundCloudId(id: number) {
      return this.media(soundcloudIds.get(id) ?? null);
    },
    ownerOf(key: string | null) {
      if (!key) return null;
      return (
        scenarios.get(key)?.owner ??
        cobaltOverrides.get(key)?.owner ??
        tunnelOverrides.get(key)?.owner ??
        releasedOwners.get(key) ??
        null
      );
    },
    nextCobalt(key: string) {
      const sequence =
        cobaltOverrides.get(key)?.value ?? (this.media(key) ?? this.post(key))?.cobalt;
      if (!sequence) return undefined;
      return pick(sequence, cursor(key).cobalt++);
    },
    nextTunnel(key: string) {
      const sequence =
        tunnelOverrides.get(key)?.value ?? (this.media(key) ?? this.post(key))?.tunnel;
      if (!sequence) return undefined;
      return pick(sequence, cursor(key).tunnel++);
    },
    createTunnel(tunnel: Tunnel) {
      const id = crypto.randomUUID().replaceAll("-", "").slice(0, 21);
      tunnels.set(id, tunnel);
      return id;
    },
    tunnel(id: string | null) {
      return id ? tunnels.get(id) : undefined;
    },
    releasedTunnelKey(id: string | null) {
      return id ? (releasedTunnels.get(id) ?? null) : null;
    },
    hang(key: string) {
      return new Promise<void>((resolve) => {
        const set = hangs.get(key) ?? new Set();
        hangs.set(key, set);
        const done = () => {
          clearTimeout(timer);
          set.delete(done);
          resolve();
        };
        const timer = setTimeout(done, HANG_LIMIT_MS);
        set.add(done);
      });
    },
    consumeRateLimit(binding: string, key: string): boolean | "unavailable" {
      const entry = rateLimits.get(rateLimitKey(binding, key))?.value;
      if (!entry) return true;
      if (entry.rule.limit === "unavailable") return "unavailable";
      entry.used += 1;
      return entry.used <= entry.rule.limit;
    },
    record(call: UpstreamCall) {
      calls.push(call);
      if (call.unexpected) {
        console.error(`[e2e] unexpected upstream call ${call.method} ${call.url} (${call.route})`);
      }
    },
    calls(filter: CallFilter) {
      return calls.filter(
        (call) =>
          (filter.since === undefined || call.at >= filter.since) &&
          (filter.unexpected === undefined || call.unexpected === filter.unexpected) &&
          (filter.owner === undefined ||
            call.owner === filter.owner ||
            (filter.includeUnowned === true && call.owner === null)),
      );
    },
  };
};

export type Registry = ReturnType<typeof createRegistry>;
