import { createHmac, timingSafeEqual } from "node:crypto";

type CobaltMachineAffinityEnv = {
  COBALT_MACHINE_AFFINITY_SECRET?: string;
};

const cobaltMachineIdPattern = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const isCobaltMachineId = (machineId: string) => cobaltMachineIdPattern.test(machineId);

export const parseCobaltMachineId = (machineId: string | null) => {
  if (machineId === null) {
    return undefined;
  }

  if (!isCobaltMachineId(machineId)) {
    throw new Error("Cobalt returned invalid machine id.");
  }

  return machineId;
};

export const getCobaltMachineAffinitySecret = (runtimeEnv: CobaltMachineAffinityEnv) => {
  if (!runtimeEnv.COBALT_MACHINE_AFFINITY_SECRET) {
    throw new Error("COBALT_MACHINE_AFFINITY_SECRET is not configured.");
  }

  return runtimeEnv.COBALT_MACHINE_AFFINITY_SECRET;
};

export const signCobaltMachine = (
  runtimeEnv: CobaltMachineAffinityEnv,
  tunnelUrl: string,
  machineId: string,
) =>
  createHmac("sha256", getCobaltMachineAffinitySecret(runtimeEnv))
    .update(machineId)
    .update("\n")
    .update(tunnelUrl)
    .digest("hex");

export const isValidCobaltMachineSignature = (
  runtimeEnv: CobaltMachineAffinityEnv,
  tunnelUrl: string,
  machineId: string,
  signature: string,
) => {
  const expected = signCobaltMachine(runtimeEnv, tunnelUrl, machineId);
  const signatureBytes = new TextEncoder().encode(signature);
  const expectedBytes = new TextEncoder().encode(expected);

  return (
    signatureBytes.length === expectedBytes.length && timingSafeEqual(signatureBytes, expectedBytes)
  );
};
