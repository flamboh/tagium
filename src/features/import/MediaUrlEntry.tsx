"use client";

import { useRef, useState } from "react";
import { ArrowRight, Link2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MediaUrlEntryLayout } from "@/features/import/mediaUrlEntryPresentation";
import {
  getSystemFailurePresentation,
  reportSystemFailure,
} from "@/features/workspace/systemFailure";
import { SharedAlbumUnavailableError, SharedAlbumVersionError } from "@/features/share/shareClient";
import { InvalidShareLinkError, ShareLinksDisabledError } from "@/features/share/shareLink";

export interface MediaUrlEntryController {
  sourceUrl: string;
  submitting: boolean;
  validationError: string | null;
  setSourceUrl: (sourceUrl: string) => void;
  submit: () => Promise<boolean>;
}

type MediaUrlEntryProps = {
  layout: MediaUrlEntryLayout;
  controller?: MediaUrlEntryController;
  onUrlImport: (sourceUrl: string) => void | Promise<void>;
};

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

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

export function useMediaUrlEntryController(
  onUrlImport: (sourceUrl: string) => void | Promise<void>,
): MediaUrlEntryController {
  const [sourceUrl, setSourceUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const submit = async () => {
    if (submitting) return true;
    const trimmedUrl = sourceUrl.trim();
    const localError = validateMediaUrl(trimmedUrl);
    if (localError) {
      setValidationError(localError);
      return false;
    }

    setSubmitting(true);
    setValidationError(null);
    try {
      await onUrlImport(trimmedUrl);
      setSourceUrl("");
      return true;
    } catch (error) {
      if (
        error instanceof InvalidShareLinkError ||
        error instanceof ShareLinksDisabledError ||
        error instanceof SharedAlbumUnavailableError
      ) {
        setValidationError(error.message);
        return false;
      } else if (error instanceof SharedAlbumVersionError) {
        setValidationError("this link was made by a newer tagium version");
        return false;
      } else {
        const presentation = getSystemFailurePresentation(error, "import");
        if (
          presentation.code === "unsupported_source" ||
          presentation.code === "private_or_missing"
        ) {
          setValidationError(presentation.description.toLowerCase().replace(/\.$/, ""));
          return false;
        } else {
          reportSystemFailure(error, "import");
          return true;
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return {
    sourceUrl,
    submitting,
    validationError,
    setSourceUrl: (nextSourceUrl) => {
      setSourceUrl(nextSourceUrl);
      setValidationError(null);
    },
    submit,
  };
}

export default function MediaUrlEntry({
  layout,
  controller: controlledController,
  onUrlImport,
}: MediaUrlEntryProps) {
  const internalController = useMediaUrlEntryController(onUrlImport);
  const controller = controlledController ?? internalController;
  const feedbackRef = useRef<HTMLDivElement>(null);

  const showValidationFeedback = () => {
    const feedback = feedbackRef.current;
    if (!feedback || prefersReducedMotion() || typeof feedback.animate !== "function") return;
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

  const canSubmit = controller.sourceUrl.trim().length > 0 && !controller.submitting;

  return (
    <div
      data-layout={layout}
      className={cn(
        layout === "landing" &&
          "flex w-full flex-col gap-10 max-lg:[@media(max-height:700px)]:gap-6",
        layout === "editor" &&
          "flex-shrink-0 border-t bg-background/95 p-3 lg:pointer-events-none lg:absolute lg:inset-x-0 lg:bottom-4 lg:z-10 lg:flex lg:justify-center lg:border-t-0 lg:bg-transparent lg:px-4 lg:p-0",
        layout === "empty-editor" &&
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center border-t bg-background/95 p-3 lg:bottom-4 lg:border-t-0 lg:bg-transparent lg:px-4 lg:p-0",
      )}
    >
      {layout !== "editor" && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          <span>or import from a url</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}
      <div className={cn("w-full", layout === "editor" ? "max-w-3xl" : "max-w-md")}>
        <div ref={feedbackRef} className="pointer-events-auto w-full bg-background">
          <form
            noValidate
            onSubmit={async (event) => {
              event.preventDefault();
              if (!(await controller.submit())) showValidationFeedback();
            }}
            className="flex items-start gap-2"
          >
            <div className="min-w-0 flex-1">
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="url"
                  name="media-url"
                  autoComplete="url"
                  value={controller.sourceUrl}
                  aria-label="media url"
                  aria-invalid={Boolean(controller.validationError)}
                  aria-describedby={controller.validationError ? "media-url-error" : undefined}
                  onChange={(event) => controller.setSourceUrl(event.target.value)}
                  placeholder="soundcloud, youtube, or tagium share link"
                  disabled={controller.submitting}
                  className="h-10 rounded-lg pl-9 placeholder:text-muted-foreground/45"
                />
              </div>
              <p
                id="media-url-error"
                className={cn(
                  "h-4 pt-0.5 text-xs leading-4",
                  controller.validationError && "text-destructive",
                  layout !== "editor" && "text-center",
                )}
                aria-live="polite"
              >
                {controller.validationError ?? ""}
              </p>
            </div>
            <Button
              type="submit"
              size="icon"
              disabled={!canSubmit}
              aria-label="start media import"
              aria-busy={controller.submitting || undefined}
              className="size-10 rounded-lg"
            >
              {controller.submitting ? <Loader2 className="animate-spin" /> : <ArrowRight />}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
