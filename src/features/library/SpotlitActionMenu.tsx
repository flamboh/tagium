"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Spotlight,
  SpotlightAnchor,
  SpotlightClose,
  SpotlightContent,
  SpotlightDescription,
  SpotlightFooter,
  SpotlightTitle,
} from "@/components/ui/spotlight";

export interface ActionSpotlight<ActionId extends string = string> {
  actionId: ActionId;
  title: string;
  description: string;
  onDismiss: () => void;
}

export function SpotlitActionMenu({
  spotlight,
  trigger,
  children,
}: {
  spotlight?: ActionSpotlight | null;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Spotlight
      open={Boolean(spotlight) && !menuOpen}
      onOpenChange={(open) => {
        if (!open) spotlight?.onDismiss();
      }}
    >
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          setMenuOpen(open);
          if (!open) spotlight?.onDismiss();
        }}
      >
        <SpotlightAnchor asChild>
          <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        </SpotlightAnchor>
        <DropdownMenuContent align="end" className="w-64">
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      {spotlight && (
        <SpotlightContent aria-label={spotlight.title}>
          <SpotlightTitle>{spotlight.title}</SpotlightTitle>
          <SpotlightDescription>{spotlight.description}</SpotlightDescription>
          <SpotlightFooter>
            <SpotlightClose asChild>
              <Button type="button" variant="ghost" size="sm">
                got it
              </Button>
            </SpotlightClose>
            <Button type="button" size="sm" onClick={() => setMenuOpen(true)}>
              show me
            </Button>
          </SpotlightFooter>
        </SpotlightContent>
      )}
    </Spotlight>
  );
}
