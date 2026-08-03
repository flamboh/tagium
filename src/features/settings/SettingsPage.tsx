"use client";

import { ArrowLeft } from "lucide-react";
import type { AppSettings } from "@/features/library/types";
import {
  AboutSettingsSection,
  DownloadsSettingsSection,
  GeneralSettingsSection,
  MetadataSettingsSection,
} from "@/features/settings/SettingsPageSections";

export interface SettingsPageProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onBack: () => void;
}

export default function SettingsPage({ settings, onChange, onBack }: SettingsPageProps) {
  return (
    <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
      <div className="p-6 h-[104px] border-b flex-shrink-0 flex flex-col justify-center gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center text-primary/80 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={onBack}
            aria-label="back to workspace"
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
          <GeneralSettingsSection settings={settings} onChange={onChange} />
          <MetadataSettingsSection settings={settings} onChange={onChange} />
          <DownloadsSettingsSection settings={settings} onChange={onChange} />
          <AboutSettingsSection />
        </div>
      </div>
    </div>
  );
}
