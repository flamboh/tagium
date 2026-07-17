import { toast } from "sonner";

export type DevToastKind = "neutral" | "success" | "error" | "info" | "warning";

export const devToastKinds: DevToastKind[] = ["neutral", "success", "error", "info", "warning"];

export const spawnDevToast = (kind: DevToastKind) => {
  const title = `${kind} toast`;
  const options = { description: "previewing Tagium's notification styling" };

  if (kind === "neutral") {
    toast(title, options);
    return;
  }

  toast[kind](title, options);
};
