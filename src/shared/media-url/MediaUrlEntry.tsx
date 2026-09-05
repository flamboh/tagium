"use client";

import { type ReactNode } from "react";
import { ArrowRight02Icon, Link02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { m, useAnimate, useReducedMotion } from "motion/react";
import { loaderCircleIcon } from "@/components/icons/loaderCircle";
import { Button } from "@/components/ui/button";
import { IconSwap } from "@/components/ui/icon-swap";
import { Input } from "@/components/ui/input";
import { morphTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type MediaUrlEntryLayout = "landing" | "standalone" | "empty-editor" | "editor";

export interface MediaUrlEntryController {
  sourceUrl: string;
  submitting: boolean;
  validationError: string | null;
  setSourceUrl: (sourceUrl: string) => void;
  submit: () => Promise<boolean>;
}

type MediaUrlEntryProps = {
  layout: MediaUrlEntryLayout;
  controller: MediaUrlEntryController;
  leadingAction?: ReactNode;
  placeholder?: string;
  submitAriaLabel?: string;
};

export default function MediaUrlEntry({
  layout,
  controller,
  leadingAction,
  placeholder = "soundcloud, youtube, or tagium share link",
  submitAriaLabel = "start media import",
}: MediaUrlEntryProps) {
  const [scope, animate] = useAnimate();
  const reducedMotion = useReducedMotion();

  const showValidationFeedback = () => {
    if (!scope.current || reducedMotion) return;
    animate(scope.current, { x: [0, -5, 4, -2, 0] }, { duration: 0.36, ease: "easeOut" });
  };

  const canSubmit = controller.sourceUrl.trim().length > 0 && !controller.submitting;

  return (
    <div
      data-layout={layout}
      className={cn(
        layout === "landing" &&
          "flex w-full flex-col gap-10 max-lg:[@media(max-height:700px)]:gap-6",
        layout === "standalone" && "w-full",
        layout === "editor" &&
          "flex-shrink-0 border-t bg-background/95 p-3 lg:pointer-events-none lg:absolute lg:inset-x-0 lg:bottom-4 lg:z-10 lg:flex lg:justify-center lg:border-t-0 lg:bg-transparent lg:px-4 lg:p-0",
        layout === "empty-editor" &&
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center border-t bg-background/95 p-3 lg:bottom-4 lg:border-t-0 lg:bg-transparent lg:px-4 lg:p-0",
      )}
    >
      {layout === "landing" && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          <span>or import from a url</span>
          <div className="h-px flex-1 bg-border" />
        </div>
      )}
      <div
        className={cn(
          "w-full",
          layout === "landing" || layout === "standalone" ? "max-w-md" : "max-w-3xl",
        )}
      >
        <m.div
          ref={scope}
          layout
          transition={morphTransition}
          className="pointer-events-auto w-full bg-background"
        >
          <m.form
            layout
            noValidate
            onSubmit={async (event) => {
              event.preventDefault();
              if (!(await controller.submit())) showValidationFeedback();
            }}
            className="flex items-start gap-2"
          >
            {leadingAction !== undefined && leadingAction !== null && (
              <m.div layout className="shrink-0">
                {leadingAction}
              </m.div>
            )}
            <m.div layout className="min-w-0 flex-1">
              <div className="relative">
                <HugeiconsIcon
                  icon={Link02Icon}
                  strokeWidth={2}
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="url"
                  name="media-url"
                  autoComplete="url"
                  value={controller.sourceUrl}
                  aria-label="media url"
                  aria-invalid={Boolean(controller.validationError)}
                  aria-describedby={controller.validationError ? "media-url-error" : undefined}
                  onChange={(event) => controller.setSourceUrl(event.target.value)}
                  placeholder={placeholder}
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
            </m.div>
            <m.div layout className="shrink-0">
              <Button
                type="submit"
                size="icon"
                disabled={!canSubmit}
                aria-label={submitAriaLabel}
                aria-busy={controller.submitting || undefined}
                className="size-10 rounded-lg"
              >
                <IconSwap
                  switched={controller.submitting}
                  first={
                    <HugeiconsIcon
                      icon={ArrowRight02Icon}
                      strokeWidth={2}
                      className="size-4"
                      data-media-url-submit-icon="enter"
                    />
                  }
                  second={
                    <HugeiconsIcon
                      icon={loaderCircleIcon}
                      strokeWidth={2}
                      className="size-4 animate-spin"
                      data-media-url-submit-icon="loading"
                    />
                  }
                />
              </Button>
            </m.div>
          </m.form>
        </m.div>
      </div>
    </div>
  );
}
