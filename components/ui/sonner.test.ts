import { describe, expect, it } from "vite-plus/test";
import sonnerSource from "./sonner.tsx?raw";

describe("Tagium toaster palette", () => {
  it("maps Sonner semantic colors to app theme tokens", () => {
    expect(sonnerSource).toContain('"--success-bg": "var(--accent)"');
    expect(sonnerSource).toContain('"--success-border": "var(--primary)"');
    expect(sonnerSource).toContain('"--success-text": "var(--accent-foreground)"');
    expect(sonnerSource).toContain(
      '"--error-bg": "color-mix(in oklch, var(--destructive) 12%, var(--popover))"',
    );
    expect(sonnerSource).toContain(
      '"--error-border": "color-mix(in oklch, var(--destructive) 35%, var(--border))"',
    );
    expect(sonnerSource).toContain('"--error-text": "var(--destructive)"');
  });
});
