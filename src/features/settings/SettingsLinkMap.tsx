"use client";

import { Link02Icon, Unlink02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import {
  METADATA_LINK_DESCRIPTORS,
  isMetadataLinkEnabled,
  isMetadataLinkVisible,
  withMetadataLinkEnabled,
  type MetadataLinkDescriptor,
  type MetadataLinkGroup,
} from "@/features/library/metadataLinks";
import type { AppSettings } from "@/features/library/types";
import { cn } from "@/lib/utils";

interface SettingsLinkMapProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

// `source` names what a row reads from, `synced` what it writes to. Both column headers are
// prefixed with their role so the direction of every wire is readable without clicking one.
const linkGroups = [
  { id: "fromAlbum", source: "album", synced: "track" },
  { id: "fromTrack", source: "track", synced: "track" },
] as const satisfies ReadonlyArray<{
  id: MetadataLinkGroup;
  source: string;
  synced: string;
}>;

function LinkRow({
  descriptor,
  settings,
  onChange,
}: SettingsLinkMapProps & { descriptor: MetadataLinkDescriptor }) {
  const linked = isMetadataLinkEnabled(settings, descriptor);
  const nodeClassName = "hidden min-h-11 items-center text-sm sm:flex";
  // The two stubs grow out of the chain when a link is on and retract into it when it is cut, so
  // breaking a link reads as the wire pulling apart rather than as a change of line style.
  const wireClassName = cn(
    "hidden h-0.5 flex-1 bg-brand transition-transform duration-200 ease-out motion-reduce:transition-none sm:block",
    linked ? "scale-x-100" : "scale-x-0",
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b py-3 last:border-b-0 sm:contents">
      <span
        className={cn(
          "text-sm font-medium leading-5 transition-colors motion-reduce:transition-none sm:hidden",
          !linked && "text-muted-foreground",
        )}
      >
        {descriptor.label}
      </span>
      <div className={cn(nodeClassName, "pr-3")}>{descriptor.map.source}</div>
      <div className="flex items-center justify-center sm:min-h-11">
        <span className={cn(wireClassName, "origin-right")} aria-hidden="true" />
        <Button
          type="button"
          role="switch"
          aria-checked={linked}
          aria-label={descriptor.label}
          variant={linked ? "default" : "outline"}
          size="icon"
          className={cn(
            "relative z-10 size-11 rounded-full transition-[color,background-color,border-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:size-8",
            !linked &&
              "border-border bg-card text-muted-foreground shadow-none hover:border-brand hover:bg-card hover:text-brand focus-visible:border-brand focus-visible:text-brand dark:border-border dark:bg-card dark:hover:bg-card",
          )}
          onClick={() => onChange(withMetadataLinkEnabled(settings, descriptor, !linked))}
        >
          {linked ? (
            <HugeiconsIcon icon={Link02Icon} strokeWidth={2} aria-hidden="true" />
          ) : (
            <HugeiconsIcon icon={Unlink02Icon} strokeWidth={2} aria-hidden="true" />
          )}
        </Button>
        <span className={cn(wireClassName, "origin-left")} aria-hidden="true" />
      </div>
      <div
        className={cn(
          nodeClassName,
          "pl-3 transition-colors motion-reduce:transition-none",
          !linked && "text-muted-foreground",
        )}
      >
        {descriptor.map.target}
      </div>
    </div>
  );
}

export default function SettingsLinkMap({ settings, onChange }: SettingsLinkMapProps) {
  const visibleDescriptors = METADATA_LINK_DESCRIPTORS.filter((descriptor) =>
    isMetadataLinkVisible(descriptor, settings),
  );

  return (
    // One grid spans both groups so every chain lines up down the whole map, however long an
    // individual group's field names are; the groups opt into its columns with subgrid.
    <div className="flex flex-col gap-7 sm:grid sm:w-fit sm:grid-cols-[auto_4.5rem_auto]">
      {linkGroups.map((group) => {
        const descriptors = visibleDescriptors.filter(
          (descriptor) => descriptor.map.group === group.id,
        );

        return (
          <section
            key={group.id}
            aria-label={`${group.source} field synced to ${group.synced} field`}
            className="sm:col-span-3 sm:grid sm:grid-cols-subgrid"
          >
            <div className="mb-2 text-[0.6875rem] tracking-widest text-muted-foreground sm:hidden">
              {group.source} field → {group.synced} field
            </div>
            <span className="mb-3 hidden pr-3 text-[0.6875rem] tracking-widest text-muted-foreground sm:block">
              source {group.source} field
            </span>
            <span
              aria-hidden="true"
              className="mb-3 hidden text-center text-[0.6875rem] tracking-widest text-muted-foreground sm:block"
            >
              →
            </span>
            <span className="mb-3 hidden pl-3 text-[0.6875rem] tracking-widest text-muted-foreground sm:block">
              synced {group.synced} field
            </span>
            <div className="border-y sm:col-span-3 sm:grid sm:grid-cols-subgrid sm:border-0">
              {descriptors.map((descriptor) => (
                <LinkRow
                  key={descriptor.id}
                  descriptor={descriptor}
                  settings={settings}
                  onChange={onChange}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
