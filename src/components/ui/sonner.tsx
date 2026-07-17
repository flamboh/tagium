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
        "--success-bg": "var(--popover)",
        "--success-border": "var(--border)",
        "--success-text": "var(--popover-foreground)",
        "--error-bg": "var(--popover)",
        "--error-border": "var(--border)",
        "--error-text": "var(--popover-foreground)",
        "--info-bg": "var(--popover)",
        "--info-border": "var(--border)",
        "--info-text": "var(--popover-foreground)",
        "--warning-bg": "var(--popover)",
        "--warning-border": "var(--border)",
        "--warning-text": "var(--popover-foreground)",
        "--border-radius": "var(--radius)",
      } as CSSProperties
    }
    {...props}
  />
);

export { Toaster };
