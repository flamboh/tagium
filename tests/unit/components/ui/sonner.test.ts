import { describe, expect, it } from "vite-plus/test";
import sonnerSource from "@/components/ui/sonner.tsx?raw";

describe("Tagium toaster palette", () => {
  it("maps Sonner semantic colors to app theme tokens", () => {
    for (const kind of ["success", "error", "info", "warning"]) {
      expect(sonnerSource).toContain(`"--${kind}-bg": "var(--popover)"`);
      expect(sonnerSource).toContain(`"--${kind}-border": "var(--border)"`);
      expect(sonnerSource).toContain(`"--${kind}-text": "var(--popover-foreground)"`);
    }
  });
});
