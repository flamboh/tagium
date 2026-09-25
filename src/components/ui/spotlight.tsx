"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

const spotlightTargetClassName =
  "data-[spotlight=active]:opacity-100 data-[spotlight=active]:outline-2 data-[spotlight=active]:outline-offset-1 data-[spotlight=active]:outline-solid data-[spotlight=active]:outline-brand data-[spotlight=active]:animate-spotlight-pulse motion-reduce:data-[spotlight=active]:animate-none";

const SpotlightContext = React.createContext<{
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
}>({ open: false, anchorRef: { current: null } });

function Spotlight({ open = false, ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const anchorRef = React.useRef<HTMLElement | null>(null);
  const context = React.useMemo(() => ({ open, anchorRef }), [open]);
  return (
    <SpotlightContext.Provider value={context}>
      <PopoverPrimitive.Root data-slot="spotlight" open={open} {...props} />
    </SpotlightContext.Provider>
  );
}

function SpotlightAnchor({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  const { open, anchorRef } = React.useContext(SpotlightContext);
  return (
    <PopoverPrimitive.Anchor
      ref={(node) => {
        anchorRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      data-slot="spotlight-anchor"
      data-spotlight={open ? "active" : undefined}
      className={cn(spotlightTargetClassName, className)}
      {...props}
    />
  );
}

function SpotlightContent({
  className,
  side = "right",
  align = "center",
  sideOffset = 10,
  children,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const { anchorRef } = React.useContext(SpotlightContext);
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="spotlight-content"
        side={side}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={12}
        hideWhenDetached
        onOpenAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          const target = event.target;
          if (
            (target instanceof Node && anchorRef.current?.contains(target)) ||
            (target instanceof Element && target.closest("[data-spotlight-ignore]"))
          ) {
            event.preventDefault();
            return;
          }
          onInteractOutside?.(event);
        }}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 flex w-64 origin-(--radix-popover-content-transform-origin) flex-col gap-1.5 rounded-md border border-brand/40 p-3 shadow-lg outline-hidden",
          className,
        )}
        {...props}
      >
        {children}
        <PopoverPrimitive.Arrow className="fill-popover stroke-brand/40" width={12} height={6} />
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

function SpotlightTitle({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="spotlight-title"
      className={cn("text-sm font-medium leading-tight", className)}
      {...props}
    />
  );
}

function SpotlightDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="spotlight-description"
      className={cn("text-xs leading-snug text-muted-foreground", className)}
      {...props}
    />
  );
}

function SpotlightFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="spotlight-footer"
      className={cn("mt-1 flex items-center justify-end gap-2", className)}
      {...props}
    />
  );
}

function SpotlightClose(props: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="spotlight-close" {...props} />;
}

export {
  Spotlight,
  SpotlightAnchor,
  SpotlightContent,
  SpotlightTitle,
  SpotlightDescription,
  SpotlightFooter,
  SpotlightClose,
};
