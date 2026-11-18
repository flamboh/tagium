"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Metadata fields are one uninterrupted outlined box with the label seated inside its top
 * edge, so the outline never has to be notched or painted over. The label borrows the small
 * wide-tracked caption idiom used elsewhere in the app (see SettingsLinkMap), and the control
 * keeps every one of its own states — border, focus ring, invalid, disabled.
 */
const insetLabelClassName = cn(
  "pointer-events-none absolute top-2.5 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-0.5",
  "text-[0.6875rem] leading-tight tracking-widest text-muted-foreground transition-colors select-none",
  "peer-focus-visible:text-ring peer-aria-invalid:text-destructive",
);

/** Reserves room for the inset label above the value and gives disabled fields a dashed outline. */
const insetFieldClassName = "peer px-3 pt-7 disabled:border-dashed";

interface InsetFieldLabelProps {
  htmlFor: string;
  label: string;
  required?: boolean;
}

function InsetFieldLabel({ htmlFor, label, required }: InsetFieldLabelProps) {
  return (
    <label htmlFor={htmlFor} className={insetLabelClassName}>
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
        className={cn(insetFieldClassName, "h-14 pb-1.5", className)}
        {...props}
      />
      <InsetFieldLabel htmlFor={id} label={label} required={required} />
    </div>
  );
}

type FloatingLabelTextareaProps = Omit<React.ComponentProps<"textarea">, "id"> & {
  id: string;
  label: string;
  containerClassName?: string;
};

/* There is no textarea primitive in the app, so the frame below mirrors `Input` and holds the
 * label in its own strip, letting the text scroll beneath it instead of under the label. */
const textareaFrameClassName = cn(
  "relative flex flex-col rounded-md border border-input bg-transparent pt-6 shadow-xs transition-[color,box-shadow] dark:bg-input/30",
  "has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-[3px] has-[textarea:focus-visible]:ring-ring/50",
  "has-[textarea[aria-invalid=true]]:border-destructive has-[textarea[aria-invalid=true]]:ring-destructive/20 dark:has-[textarea[aria-invalid=true]]:ring-destructive/40",
  "has-[textarea:disabled]:cursor-not-allowed has-[textarea:disabled]:border-dashed has-[textarea:disabled]:opacity-50",
);

const textareaClassName = cn(
  "peer field-scrollbar [mask-image:linear-gradient(to_bottom,transparent_0.125rem,black_0.5rem,black_calc(100%-0.5rem),transparent)] [--field-scrollbar-inset:0.5rem] flex w-full min-w-0 resize-y rounded-b-md bg-transparent px-3 pt-2 pb-2 text-base outline-none md:text-sm",
  "placeholder:text-muted-foreground selection:bg-brand selection:text-background disabled:pointer-events-none",
);

function FloatingLabelTextarea({
  id,
  label,
  required,
  className,
  containerClassName,
  ...props
}: FloatingLabelTextareaProps) {
  return (
    <div
      data-slot="floating-label-field"
      className={cn(textareaFrameClassName, containerClassName)}
    >
      <textarea
        id={id}
        required={required}
        className={cn(textareaClassName, "min-h-12", className)}
        {...props}
      />
      <InsetFieldLabel htmlFor={id} label={label} required={required} />
    </div>
  );
}

export { FloatingLabelInput, FloatingLabelTextarea };
