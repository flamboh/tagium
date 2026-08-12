"use client";

import { useState } from "react";
import { GithubIcon, TwitterIcon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AppSettings } from "@/features/library/types";
import SettingsLinkMap from "@/features/settings/SettingsLinkMap";
import { AUDIO_BITRATE_OPTIONS } from "@/features/settings/settings";

interface SettingsSectionProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

const checkboxRowClassName = "flex cursor-pointer select-none items-start gap-3 py-1";

export function ImportingSettingsSection({ settings, onChange }: SettingsSectionProps) {
  const [bitrateOpen, setBitrateOpen] = useState(false);

  return (
    <section className="flex max-w-xl flex-col gap-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">importing</h3>
        <p className="text-sm leading-5 text-muted-foreground">
          choose what happens the moment audio lands in your library.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <span id="download-bitrate-label" className="text-sm font-medium">
          download bitrate
        </span>
        <Popover open={bitrateOpen} onOpenChange={setBitrateOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-9 w-full justify-between px-2 font-normal"
              aria-labelledby="download-bitrate-label"
            >
              <span>
                {settings.audioBitrate} <span className="text-muted-foreground">kbps</span>
              </span>
              <HugeiconsIcon
                icon={UnfoldMoreIcon}
                strokeWidth={2}
                className="size-4 text-muted-foreground"
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) p-1"
            role="listbox"
          >
            {AUDIO_BITRATE_OPTIONS.map((bitrate) => (
              <Button
                key={bitrate}
                type="button"
                variant="ghost"
                className={`h-8 w-full justify-start px-2 font-normal ${settings.audioBitrate === bitrate ? "bg-accent text-accent-foreground" : ""}`}
                aria-selected={settings.audioBitrate === bitrate}
                role="option"
                onClick={() => {
                  onChange({ ...settings, audioBitrate: bitrate });
                  setBitrateOpen(false);
                }}
              >
                {bitrate} <span className="text-muted-foreground">kbps</span>
              </Button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
      <label className={checkboxRowClassName}>
        <Checkbox
          checked={settings.applySoundCloudAlbumCoverToTracks}
          onCheckedChange={(checked) =>
            onChange({
              ...settings,
              applySoundCloudAlbumCoverToTracks: checked === true,
            })
          }
          className="mt-0.5"
        />
        <span className="space-y-0.5">
          <span className="block text-sm font-medium leading-5">
            use the soundcloud album cover for every track
          </span>
          <span className="block text-xs leading-5 text-muted-foreground">
            applied once at import. individual track covers stay editable afterwards.
          </span>
        </span>
      </label>
    </section>
  );
}

export function EditingSettingsSection({ settings, onChange }: SettingsSectionProps) {
  return (
    <section className="flex max-w-xl flex-col gap-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">editing</h3>
        <p className="text-sm leading-5 text-muted-foreground">
          choose which fields the track editor shows you.
        </p>
      </div>
      <label className={checkboxRowClassName}>
        <Checkbox
          id="advanced-metadata"
          checked={settings.advancedMetadata}
          onCheckedChange={(checked) =>
            onChange({
              ...settings,
              advancedMetadata: checked === true,
            })
          }
          className="mt-0.5"
        />
        <span className="space-y-0.5">
          <span className="block text-sm font-medium leading-5">show advanced fields</span>
          <span className="block text-xs leading-5 text-muted-foreground">
            adds album artist, disc number, composer, bpm, and comments to the track editor.
          </span>
        </span>
      </label>
    </section>
  );
}

export function LinkingSettingsSection({ settings, onChange }: SettingsSectionProps) {
  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">linking</h3>
        <p className="max-w-[65ch] text-sm leading-5 text-muted-foreground">
          linked fields are synced with their source. unlink a field to allow it to be freely
          edited.
        </p>
      </div>
      <SettingsLinkMap settings={settings} onChange={onChange} />
    </section>
  );
}

export function AboutSettingsSection() {
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">about</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            tagium exists to make device-local music more accessible to everyone.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">ethics</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            tagium is not a piracy tool and cannot be used as one. it only works with free, publicly
            accessible audio. it cannot be used to bypass paywalls or access private content.
          </p>
          <p className="text-sm leading-6 text-muted-foreground">
            you are responsible for the content you download and how you use it. credit original
            creators, support artists, and don't violate any terms or licenses.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">acknowledgements</h3>
          <div className="flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
            <p>
              <a
                href="https://cobalt.tools/"
                target="_blank"
                rel="noreferrer"
                className="cursor-pointer text-brand underline-offset-4 hover:underline"
              >
                cobalt
              </a>{" "}
              and{" "}
              <a
                href="https://imput.net/"
                target="_blank"
                rel="noreferrer"
                className="cursor-pointer text-brand underline-offset-4 hover:underline"
              >
                imput
              </a>
              , for their incredible downloading api service. they're a huge inspiration for this
              tool!
            </p>
          </div>
        </div>
      </section>

      <nav className="flex items-center gap-3" aria-label="social links">
        <a
          href="https://github.com/flamboh/tagium"
          target="_blank"
          rel="noreferrer"
          aria-label="github"
          className="inline-flex size-12 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
        >
          <HugeiconsIcon icon={GithubIcon} strokeWidth={2} className="size-6" aria-hidden="true" />
        </a>
        <a
          href="https://x.com/flambohh"
          target="_blank"
          rel="noreferrer"
          aria-label="twitter"
          className="inline-flex size-12 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
        >
          <HugeiconsIcon icon={TwitterIcon} strokeWidth={2} className="size-6" aria-hidden="true" />
        </a>
      </nav>
    </div>
  );
}
