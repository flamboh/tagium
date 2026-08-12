"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface FloatingFieldLabelProps {
  htmlFor: string;
  label: string;
  required?: boolean;
}

function FloatingFieldLabel({ htmlFor, label, required }: FloatingFieldLabelProps) {
  return (
    <label
      htmlFor={htmlFor}
      className="absolute left-2.5 top-0 z-10 flex max-w-[calc(100%-1.25rem)] -translate-y-1/2 items-center gap-0.5 bg-background px-1 text-xs leading-none font-medium text-muted-foreground transition-colors peer-focus-visible:text-ring peer-aria-invalid:text-destructive"
    >
      <span className="truncate">{label}</span>
      {required && (
        <>
          <span className="shrink-0 text-destructive" aria-hidden="true">
            *
          </span>
          <span className="sr-only"> required</span>
        </>
      )}
    </label>
  );
}

type FloatingLabelInputProps = Omit<React.ComponentProps<typeof Input>, "id"> & {
  id: string;
  label: string;
  containerClassName?: string;
};

function FloatingLabelInput({
  id,
  label,
  required,
  className,
  containerClassName,
  ...props
}: FloatingLabelInputProps) {
  return (
    <div data-slot="floating-label-field" className={cn("relative", containerClassName)}>
      <Input
        id={id}
        required={required}
        className={cn("peer h-14 px-3 pb-1.5 pt-4 placeholder:text-muted-foreground", className)}
        {...props}
      />
      <FloatingFieldLabel htmlFor={id} label={label} required={required} />
    </div>
  );
}

type FloatingLabelTextareaProps = Omit<React.ComponentProps<"textarea">, "id"> & {
  id: string;
  label: string;
  containerClassName?: string;
};

function FloatingLabelTextarea({
  id,
  label,
  required,
  className,
  containerClassName,
  ...props
}: FloatingLabelTextareaProps) {
  return (
    <div data-slot="floating-label-field" className={cn("relative", containerClassName)}>
      <textarea
        id={id}
        required={required}
        className={cn(
          "peer border-input placeholder:text-muted-foreground selection:bg-brand selection:text-background dark:bg-input/30 flex min-h-20 w-full resize-y rounded-md border bg-transparent px-3 pb-2 pt-4 text-base shadow-xs transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
          className,
        )}
        {...props}
      />
      <FloatingFieldLabel htmlFor={id} label={label} required={required} />
    </div>
  );
}

export { FloatingLabelInput, FloatingLabelTextarea };
