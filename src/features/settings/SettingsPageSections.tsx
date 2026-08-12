"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  METADATA_LINK_SETTINGS_DESCRIPTORS,
  isMetadataLinkEnabled,
  isMetadataLinkVisible,
  withMetadataLinkEnabled,
} from "@/features/library/metadataLinks";
import type { AppSettings } from "@/features/library/types";
import { AUDIO_BITRATE_OPTIONS } from "@/features/settings/settings";

interface SettingsSectionProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

const checkboxRowClassName = "flex cursor-pointer select-none items-start gap-3 py-1";

export function GeneralSettingsSection({ settings, onChange }: SettingsSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">general</h3>
        <p className="text-sm leading-5 text-muted-foreground">
          choose how tracks are numbered and files are named while you edit.
        </p>
      </div>
      <div className={checkboxRowClassName}>
        <Checkbox
          id="sync-track-numbers"
          checked={settings.syncTrackNumbers}
          onCheckedChange={(checked) =>
            onChange({
              ...settings,
              syncTrackNumbers: checked === true,
            })
          }
          className="mt-0.5"
        />
        <Label htmlFor="sync-track-numbers" className="cursor-pointer leading-5">
          use album sidebar order as track number
        </Label>
      </div>
      <div className={checkboxRowClassName}>
        <Checkbox
          id="sync-filenames"
          checked={settings.syncFilenames}
          onCheckedChange={(checked) =>
            onChange({
              ...settings,
              syncFilenames: checked === true,
            })
          }
          className="mt-0.5"
        />
        <Label htmlFor="sync-filenames" className="cursor-pointer leading-5">
          sync all filenames with track titles
        </Label>
      </div>
    </section>
  );
}

export function MetadataSettingsSection({ settings, onChange }: SettingsSectionProps) {
  const [metadataLinksOpen, setMetadataLinksOpen] = useState(false);
  const metadataLinksContentId = useId();
  const visibleMetadataLinks = METADATA_LINK_SETTINGS_DESCRIPTORS.filter((descriptor) =>
    isMetadataLinkVisible(descriptor, settings),
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">metadata</h3>
        <p className="text-sm leading-5 text-muted-foreground">
          control which tags appear in the editor and how metadata stays in sync.
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
          <span className="block text-sm font-medium leading-5">enable advanced metadata</span>
          <span className="block text-xs leading-5 text-muted-foreground">
            adds album artist, disc number, composer, bpm, and comments to the track editor.
          </span>
        </span>
      </label>

      <div
        className="group/metadata-linking mt-1 border-t pt-3"
        data-state={metadataLinksOpen ? "open" : "closed"}
      >
        <button
          type="button"
          className="flex w-full cursor-pointer select-none items-center justify-between rounded-md py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-expanded={metadataLinksOpen}
          aria-controls={metadataLinksContentId}
          onClick={() => setMetadataLinksOpen((open) => !open)}
        >
          <span>metadata linking</span>
          <ChevronDown
            className="size-4 text-muted-foreground transition-transform duration-200 ease-out group-data-[state=open]/metadata-linking:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </button>
        <div
          id={metadataLinksContentId}
          aria-hidden={!metadataLinksOpen}
          inert={!metadataLinksOpen}
          data-metadata-linking-content
          className="grid grid-rows-[0fr] opacity-0 transition-[grid-template-rows,opacity] duration-200 ease-out group-data-[state=open]/metadata-linking:grid-rows-[1fr] group-data-[state=open]/metadata-linking:opacity-100 motion-reduce:transition-none"
        >
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-col gap-2 pt-2">
              {visibleMetadataLinks.map((descriptor) => (
                <label key={descriptor.id} className={checkboxRowClassName}>
                  <Checkbox
                    checked={isMetadataLinkEnabled(settings, descriptor)}
                    onCheckedChange={(checked) =>
                      onChange(withMetadataLinkEnabled(settings, descriptor, checked === true))
                    }
                    className="mt-0.5"
                  />
                  <span className="text-sm font-medium leading-5">{descriptor.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function DownloadsSettingsSection({ settings, onChange }: SettingsSectionProps) {
  const [bitrateOpen, setBitrateOpen] = useState(false);

  return (
    <section className="flex flex-col gap-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">downloads</h3>
        <p className="text-sm leading-5 text-muted-foreground">
          choose the defaults used for imported audio.
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
              <ChevronsUpDown className="size-4 text-muted-foreground" />
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
        <span className="text-sm font-medium">
          automatically apply soundcloud album cover to all tracks
        </span>
      </label>
    </section>
  );
}

export function AboutSettingsSection() {
  return (
    <>
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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-6"
            aria-hidden="true"
          >
            <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
            <path d="M9 18c-4.51 2-5-2-7-2" />
          </svg>
        </a>
        <a
          href="https://x.com/flambohh"
          target="_blank"
          rel="noreferrer"
          aria-label="twitter"
          className="inline-flex size-12 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-6"
            aria-hidden="true"
          >
            <path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z" />
          </svg>
        </a>
      </nav>
    </>
  );
}
