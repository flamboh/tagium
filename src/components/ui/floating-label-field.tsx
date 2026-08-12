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
      className="absolute left-2 top-0 z-20 flex max-w-[calc(100%-1rem)] -translate-y-1/2 items-center gap-0.5 px-1 text-xs leading-none font-medium text-muted-foreground transition-colors peer-focus-visible:text-ring peer-aria-invalid:text-destructive"
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

function FloatingFieldOutline({ label, required }: Omit<FloatingFieldLabelProps, "htmlFor">) {
  return (
    <fieldset
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 m-0 min-w-0 rounded-md border border-input px-2 py-0 shadow-xs transition-[border-color,box-shadow] peer-focus-visible:border-ring peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50 peer-aria-invalid:border-destructive peer-aria-invalid:ring-destructive/20 peer-disabled:border-dashed dark:peer-aria-invalid:ring-destructive/40"
    >
      <legend className="float-none w-auto max-w-[calc(100%-1rem)] overflow-hidden whitespace-nowrap p-0 text-xs leading-none">
        <span className="invisible inline-flex max-w-full items-center gap-0.5 px-1">
          <span className="truncate">{label}</span>
          {required && <span className="shrink-0">*</span>}
        </span>
      </legend>
    </fieldset>
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
    <div data-slot="floating-label-field" className={cn("relative isolate", containerClassName)}>
      <Input
        id={id}
        required={required}
        className={cn(
          "peer relative z-0 h-14 border-transparent px-3 pb-1.5 pt-4 shadow-none placeholder:text-muted-foreground",
          "focus-visible:border-transparent focus-visible:ring-0",
          "aria-invalid:border-transparent aria-invalid:ring-0",
          className,
        )}
        {...props}
      />
      <FloatingFieldLabel htmlFor={id} label={label} required={required} />
      <FloatingFieldOutline label={label} required={required} />
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
    <div data-slot="floating-label-field" className={cn("relative isolate", containerClassName)}>
      <textarea
        id={id}
        required={required}
        className={cn(
          "peer relative z-0 flex min-h-20 w-full resize-y rounded-md border border-transparent bg-transparent px-3 pb-2 pt-4 text-base shadow-none outline-none placeholder:text-muted-foreground selection:bg-brand selection:text-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
          "focus-visible:border-transparent focus-visible:ring-0",
          "aria-invalid:border-transparent aria-invalid:ring-0",
          className,
        )}
        {...props}
      />
      <FloatingFieldLabel htmlFor={id} label={label} required={required} />
      <FloatingFieldOutline label={label} required={required} />
    </div>
  );
}

export { FloatingLabelInput, FloatingLabelTextarea };
