"use client";

import type { CSSProperties } from "react";
import { useGT } from "gt-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { cn } from "@/lib/utils";

const Toaster = ({ className, toastOptions, ...props }: ToasterProps) => {
  const gt = useGT();

  return (
    <Sonner
      theme="system"
      duration={12_000}
      customAriaLabel={gt("notifications alt+t")}
      toastOptions={{ closeButtonAriaLabel: gt("close notification"), ...toastOptions }}
      className={cn("toaster tagium-toaster group", className)}
      style={
        // SAFETY: Sonner forwards CSS custom properties through its style object.
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
};

export { Toaster };
