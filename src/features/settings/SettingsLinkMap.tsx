"use client";

import { Link2, Unlink } from "lucide-react";
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
  { id: "fromAlbum", source: "album", synced: "every track" },
  { id: "fromTrack", source: "track", synced: "related fields" },
] as const satisfies ReadonlyArray<{
  id: MetadataLinkGroup;
  source: string;
  synced: string;
}>;

function LinkRow({
  descriptor,
  first,
  settings,
  onChange,
}: SettingsLinkMapProps & { descriptor: MetadataLinkDescriptor; first: boolean }) {
  const linked = isMetadataLinkEnabled(settings, descriptor);
  const nodeClassName = cn(
    "hidden min-h-11 items-center bg-card px-3 text-sm sm:flex",
    first ? "border-y" : "border-b",
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
      <div className={cn(nodeClassName, "border-l border-r-0")}>{descriptor.map.source}</div>
      <div
        className={cn(
          "relative flex items-center justify-center sm:min-h-11 sm:bg-card",
          first ? "sm:border-y" : "sm:border-b",
        )}
      >
        <div
          className={cn(
            "absolute inset-x-0 top-1/2 hidden border-t-2 transition-colors duration-150 motion-reduce:transition-none sm:block",
            linked ? "border-solid border-brand" : "border-dashed border-muted-foreground/70",
          )}
          aria-hidden="true"
        />
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
          {linked ? <Link2 aria-hidden="true" /> : <Unlink aria-hidden="true" />}
        </Button>
      </div>
      <div
        className={cn(
          nodeClassName,
          "border-r border-l-0 transition-colors motion-reduce:transition-none",
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
    <div className="flex flex-col gap-7">
      {linkGroups.map((group) => {
        const descriptors = visibleDescriptors.filter(
          (descriptor) => descriptor.map.group === group.id,
        );

        return (
          <section key={group.id} aria-label={`${group.source} synced to ${group.synced}`}>
            <div className="mb-2 text-[0.6875rem] tracking-widest text-muted-foreground sm:hidden">
              {group.source} → {group.synced}
            </div>
            <div className="mb-2 hidden grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)] text-center text-[0.6875rem] tracking-widest text-muted-foreground sm:grid lg:grid-cols-[minmax(0,1fr)_5.75rem_minmax(0,1fr)]">
              <span>source · {group.source}</span>
              <span aria-hidden="true">→</span>
              <span>synced · {group.synced}</span>
            </div>
            <div className="border-y sm:grid sm:grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)] sm:border-0 lg:grid-cols-[minmax(0,1fr)_5.75rem_minmax(0,1fr)]">
              {descriptors.map((descriptor, index) => (
                <LinkRow
                  key={descriptor.id}
                  descriptor={descriptor}
                  first={index === 0}
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
