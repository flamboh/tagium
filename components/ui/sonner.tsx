"use client";

import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { cn } from "@/lib/utils";

const Toaster = ({ className, ...props }: ToasterProps) => (
  <Sonner
    theme="system"
    duration={12_000}
    className={cn("toaster tagium-toaster group", className)}
    style={
      {
        "--normal-bg": "var(--popover)",
        "--normal-text": "var(--popover-foreground)",
        "--normal-border": "var(--border)",
        "--success-bg": "var(--accent)",
        "--success-border": "var(--primary)",
        "--success-text": "var(--accent-foreground)",
        "--error-bg": "color-mix(in oklch, var(--destructive) 12%, var(--popover))",
        "--error-border": "color-mix(in oklch, var(--destructive) 35%, var(--border))",
        "--error-text": "var(--destructive)",
        "--border-radius": "var(--radius)",
      } as CSSProperties
    }
    {...props}
  />
);

export { Toaster };
