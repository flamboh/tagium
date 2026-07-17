"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ACCENT_PRESETS,
  AUDIO_BITRATE_OPTIONS,
  MODE_OPTIONS,
  WORDMARK_FONT_OPTIONS,
  isSupportedAccentColor,
} from "./settings";
import { cssColorToHex } from "./theme";
import type { AppSettings } from "./types";

const modeDescriptions: Record<AppSettings["mode"], string> = {
  light: "bright, sharp, ink on paper",
  dark: "deep, flat, low-light liner",
};

export interface SettingsPageProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onBack: () => void;
}

interface AccentColorInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function AccentColorInput({ label, value, onChange }: AccentColorInputProps) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(value);
    setInvalid(false);
  }, [value]);

  const commit = (nextValue: string) => {
    const color = nextValue.trim();
    const valid = isSupportedAccentColor(color) && CSS.supports("color", color);
    setInvalid(!valid);
    if (valid) onChange(color);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-sm border border-input px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${label}-color-value`} className="text-sm font-medium">
          {label}
        </label>
        <input
          type="color"
          value={cssColorToHex(value)}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-10 shrink-0 cursor-pointer border-0 bg-transparent p-0"
          aria-label={`choose ${label}`}
        />
      </div>
      <input
        id={`${label}-color-value`}
        type="text"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          commit(event.target.value);
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(draft);
        }}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${label}-color-error` : undefined}
        spellCheck={false}
        placeholder="oklch(0.6 0.2 260) or rgb(20 80 190)"
        className="h-8 min-w-0 rounded-sm border border-input bg-background px-2 font-mono text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20"
      />
      {invalid && (
        <span id={`${label}-color-error`} className="text-xs text-destructive">
          enter a valid OKLCH, RGB, or hex color
        </span>
      )}
    </div>
  );
}

export default function SettingsPage({ settings, onChange, onBack }: SettingsPageProps) {
  const [bitrateOpen, setBitrateOpen] = useState(false);

  return (
    <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
      <div className="p-6 h-[104px] border-b flex-shrink-0 flex flex-col justify-center gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center text-primary/80 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={onBack}
            aria-label="back to editor"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h2 className="relative -top-px truncate text-lg font-semibold leading-tight">
            settings
          </h2>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl flex flex-col gap-6">
          <fieldset className="flex flex-col gap-3">
            <legend className="text-base font-semibold">appearance</legend>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">mode</span>
                <div className="grid grid-cols-2 gap-2">
                  {MODE_OPTIONS.map((mode) => (
                    <label
                      key={mode}
                      className="flex cursor-pointer items-start gap-3 rounded-sm border border-input px-3 py-2.5 transition-colors hover:bg-accent/50 has-checked:border-primary has-checked:bg-accent"
                    >
                      <input
                        type="radio"
                        name="mode"
                        value={mode}
                        checked={settings.mode === mode}
                        onChange={() => onChange({ ...settings, mode })}
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                      />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium leading-none">{mode}</span>
                        <span className="text-xs leading-4 text-muted-foreground">
                          {modeDescriptions[mode]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">accents</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {ACCENT_PRESETS.map((preset) => {
                    const selected =
                      settings.accentA.toLowerCase() === preset.accentA &&
                      settings.accentB.toLowerCase() === preset.accentB;
                    return (
                      <label
                        key={preset.name}
                        className="flex cursor-pointer items-center gap-3 rounded-sm border border-input px-3 py-2.5 transition-colors hover:bg-accent/50 has-checked:border-primary has-checked:bg-accent"
                      >
                        <input
                          type="radio"
                          name="accent-preset"
                          value={preset.name}
                          checked={selected}
                          onChange={() =>
                            onChange({
                              ...settings,
                              accentA: preset.accentA,
                              accentB: preset.accentB,
                            })
                          }
                          className="sr-only"
                        />
                        <span className="flex shrink-0 gap-1" aria-hidden="true">
                          <span
                            className="size-5 border border-foreground/20"
                            style={{ backgroundColor: preset.accentA }}
                          />
                          <span
                            className="size-5 border border-foreground/20"
                            style={{ backgroundColor: preset.accentB }}
                          />
                        </span>
                        <span className="text-sm leading-tight">{preset.name}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                  {(["accentA", "accentB"] as const).map((key, index) => (
                    <AccentColorInput
                      key={key}
                      label={`accent ${index === 0 ? "a" : "b"}`}
                      value={settings[key]}
                      onChange={(value) => onChange({ ...settings, [key]: value })}
                    />
                  ))}
                </div>
                <div className="flex items-start gap-3 py-1">
                  <Checkbox
                    id="darken-accents-in-dark-mode"
                    checked={settings.darkenAccentsInDarkMode}
                    onCheckedChange={(checked) =>
                      onChange({
                        ...settings,
                        darkenAccentsInDarkMode: checked === true,
                      })
                    }
                    className="mt-0.5"
                  />
                  <Label htmlFor="darken-accents-in-dark-mode" className="flex flex-col gap-0.5">
                    <span>darken accents in dark mode</span>
                    <span className="text-xs font-normal leading-4 text-muted-foreground">
                      blends the sidebar accent into the dark background
                    </span>
                  </Label>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">wordmark</span>
                <div className="grid grid-cols-2 gap-2">
                  {WORDMARK_FONT_OPTIONS.map((font) => (
                    <label
                      key={font}
                      className="flex cursor-pointer items-center gap-3 rounded-sm border border-input px-3 py-2.5 transition-colors hover:bg-accent/50 has-checked:border-primary has-checked:bg-accent"
                    >
                      <input
                        type="radio"
                        name="wordmark-font"
                        value={font}
                        checked={settings.wordmarkFont === font}
                        onChange={() => onChange({ ...settings, wordmarkFont: font })}
                        className="sr-only"
                      />
                      <span className="wordmark-option text-lg" data-font={font}>
                        tagium.
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </fieldset>

          <section className="flex flex-col gap-3">
            <h3 className="text-base font-semibold">metadata</h3>
            <div className="flex items-start gap-3 py-1">
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
              <Label htmlFor="sync-track-numbers">use album sidebar order as track number</Label>
            </div>
            <div className="flex items-start gap-3 py-1">
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
              <Label htmlFor="sync-filenames">sync all filenames with track titles</Label>
            </div>
          </section>

          <section className="flex flex-col gap-3">
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
            <label className="flex cursor-pointer items-start gap-3 py-1">
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
                automatically apply SoundCloud album cover to all tracks
              </span>
            </label>
          </section>

          <section className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">about</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                tagium exists to make device-local music more accessible to everyone.
              </p>
              <p className="text-sm leading-6 text-muted-foreground">
                listening guide: tagium currently imports, edits, and downloads mp3 audio only.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="text-base font-semibold">ethics</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                tagium is not a piracy tool and cannot be used as one. it only works with free,
                publicly accessible audio — the same content anyone can already save with the dev
                tools in any modern browser. it cannot be used to bypass paywalls or access private
                content.
              </p>
              <p className="text-sm leading-6 text-muted-foreground">
                you are responsible for the content you download and how you use it. credit original
                creators, support artists, don't violate any terms or licenses, and share the
                love.{" "}
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
                    className="cursor-pointer text-primary underline-offset-4 hover:underline"
                  >
                    cobalt
                  </a>{" "}
                  and{" "}
                  <a
                    href="https://imput.net/"
                    target="_blank"
                    rel="noreferrer"
                    className="cursor-pointer text-primary underline-offset-4 hover:underline"
                  >
                    imput
                  </a>
                  , for their incredible downloading api service. they're a huge inspiration for
                  this tool!
                </p>
                <p>
                  <a
                    href="https://mp3tag.js.org/"
                    target="_blank"
                    rel="noreferrer"
                    className="cursor-pointer text-primary underline-offset-4 hover:underline"
                  >
                    mp3tag.js
                  </a>
                  , for the fantastic metadata editing library.
                </p>
              </div>
            </div>
          </section>

          <nav className="flex items-center gap-3" aria-label="social links">
            <a
              href="https://github.com/flamboh/tagium"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
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
              aria-label="Twitter"
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
        </div>
      </div>
    </div>
  );
}
