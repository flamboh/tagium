"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSystemFailurePresentation, reportSystemFailure } from "./systemFailure";

interface MediaUrlEntryProps {
  layout: "landing" | "editor";
  hidden: boolean;
  onUrlImport: (sourceUrl: string) => void | Promise<void>;
}

const validateMediaUrl = (value: string) => {
  if (!value) return "enter a media url";
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return null;
  } catch {
    // The local validation message below is intentionally more useful than URL's exception.
  }
  return "enter a complete http or https url";
};

export default function MediaUrlEntry({ layout, hidden, onUrlImport }: MediaUrlEntryProps) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  const previousRectRef = useRef<DOMRect | null>(null);
  const previousLayoutRef = useRef(layout);

  useLayoutEffect(() => {
    const form = formRef.current;
    if (!form || hidden) {
      previousRectRef.current = null;
      previousLayoutRef.current = layout;
      return;
    }

    const nextRect = form.getBoundingClientRect();
    const previousRect = previousRectRef.current;
    const layoutChanged = previousLayoutRef.current !== layout;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (previousRect && layoutChanged && !reducedMotion) {
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;
      const scaleX = previousRect.width / Math.max(1, nextRect.width);
      form.animate(
        [
          {
            transform: `translate(${deltaX}px, ${deltaY}px) scaleX(${scaleX})`,
            transformOrigin: "top left",
          },
          { transform: "translate(0, 0) scaleX(1)", transformOrigin: "top left" },
        ],
        { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }

    previousRectRef.current = nextRect;
    previousLayoutRef.current = layout;
  }, [hidden, layout]);

  const showValidationError = (message: string) => {
    setValidationError(message);
    const feedback = feedbackRef.current;
    if (!feedback || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    feedback.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(-2px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 360, easing: "ease-out" },
    );
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const trimmedUrl = sourceUrl.trim();
    const localError = validateMediaUrl(trimmedUrl);
    if (localError) {
      showValidationError(localError);
      return;
    }

    setSubmitting(true);
    setValidationError(null);
    try {
      await onUrlImport(trimmedUrl);
      setSourceUrl("");
    } catch (error) {
      const presentation = getSystemFailurePresentation(error, "import");
      if (
        presentation.code === "unsupported_source" ||
        presentation.code === "private_or_missing"
      ) {
        showValidationError(presentation.description.toLowerCase().replace(/\.$/, ""));
      } else {
        reportSystemFailure(error, "import");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = sourceUrl.trim().length > 0 && !submitting;

  return (
    <div
      data-layout={layout}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      className={cn(
        hidden && "hidden",
        layout === "landing" && "flex w-full justify-center",
        layout === "editor" &&
          "flex-shrink-0 border-t bg-background/95 p-3 lg:pointer-events-none lg:absolute lg:inset-x-0 lg:bottom-4 lg:z-10 lg:flex lg:justify-center lg:border-t-0 lg:bg-transparent lg:px-4 lg:p-0",
      )}
    >
      <div
        ref={feedbackRef}
        className={cn(
          "pointer-events-auto flex w-full flex-col",
          layout === "landing"
            ? "max-w-md gap-10 max-lg:[@media(max-height:700px)]:gap-6"
            : "max-w-3xl gap-1",
        )}
      >
        {layout === "landing" && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>or import from a url</span>
            <div className="h-px flex-1 bg-border" />
          </div>
        )}
        <form ref={formRef} noValidate onSubmit={handleSubmit} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="url"
                name="media-url"
                autoComplete="url"
                value={sourceUrl}
                aria-label="media url"
                aria-invalid={Boolean(validationError)}
                aria-describedby={validationError ? "media-url-error" : undefined}
                onChange={(event) => {
                  setSourceUrl(event.target.value);
                  setValidationError(null);
                }}
                placeholder="soundcloud or youtube url"
                disabled={submitting}
                className={cn(
                  "pl-9 placeholder:text-muted-foreground/45",
                  layout === "landing" && "h-10 rounded-lg",
                )}
              />
            </div>
            <p
              id="media-url-error"
              className={cn(
                "h-4 pt-0.5 text-xs leading-4 text-destructive",
                layout === "landing" && "text-center",
              )}
              aria-live="polite"
            >
              {validationError ?? ""}
            </p>
          </div>
          <Button
            type="submit"
            size="icon"
            disabled={!canSubmit}
            aria-label="start media import"
            className={cn(layout === "landing" && "size-10 rounded-lg")}
          >
            {submitting ? <Loader2 className="animate-spin" /> : <ArrowRight />}
          </Button>
        </form>
      </div>
    </div>
  );
}
