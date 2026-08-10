const PRODUCTION_COBALT_ORIGINS = new Set(["https://tagium-cobalt.fly.dev"]);

export const parseLoadTestTarget = (value: string) => {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new Error(`Invalid load-test target: ${JSON.stringify(value)}.`);
  }

  if (target.protocol !== "https:") {
    throw new Error("Load-test target must use HTTPS.");
  }
  if (
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new Error("Load-test target must be an origin URL without credentials, path, or query.");
  }
  if (PRODUCTION_COBALT_ORIGINS.has(target.origin)) {
    throw new Error(`Refusing to load-test production Cobalt at ${target.origin}.`);
  }

  return target;
};

export const assertTunnelMatchesLoadTestTarget = (target: URL, tunnelValue: string) => {
  let tunnel: URL;
  try {
    tunnel = new URL(tunnelValue);
  } catch {
    throw new Error("Cobalt returned an invalid tunnel URL; aborting the load test.");
  }

  if (tunnel.origin !== target.origin) {
    throw new Error(
      `Cobalt returned tunnel origin ${tunnel.origin}, expected ${target.origin}; ` +
        "aborting before the tunnel is fetched.",
    );
  }

  return tunnel.href;
};
