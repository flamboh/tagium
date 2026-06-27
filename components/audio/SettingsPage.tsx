"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { AUDIO_BITRATE_OPTIONS } from "./settings";
import type { AudioDownloadBitrate } from "./cobaltDownload";
import type { AppSettings } from "./types";

interface SettingsPageProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
}

export default function SettingsPage({ settings, onChange }: SettingsPageProps) {
  return (
    <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
      <div className="p-6 h-[104px] border-b flex-shrink-0 flex flex-col justify-center gap-1">
        <h2 className="text-lg font-semibold truncate">settings</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl flex flex-col gap-6">
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">metadata</h3>
            <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
              <Checkbox
                checked={settings.syncTrackNumbers}
                onCheckedChange={(checked) =>
                  onChange({
                    ...settings,
                    syncTrackNumbers: checked === true,
                  })
                }
                className="mt-0.5"
              />
              <span className="text-sm font-medium">use album sidebar order as track number</span>
            </label>
            <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
              <Checkbox
                checked={settings.syncFilenames}
                onCheckedChange={(checked) =>
                  onChange({
                    ...settings,
                    syncFilenames: checked === true,
                  })
                }
                className="mt-0.5"
              />
              <span className="text-sm font-medium">sync all filenames with track titles</span>
            </label>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-medium">downloads</h3>
            <label className="flex flex-col gap-2 rounded-md border p-3">
              <span className="text-sm font-medium">download bitrate</span>
              <select
                value={settings.audioBitrate}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    audioBitrate: event.target.value as AudioDownloadBitrate,
                  })
                }
                className="border-input bg-background h-9 rounded-md border px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-input/30"
                aria-label="download bitrate"
              >
                {AUDIO_BITRATE_OPTIONS.map((bitrate) => (
                  <option key={bitrate} value={bitrate}>
                    {bitrate}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </div>
      </div>
    </div>
  );
}
