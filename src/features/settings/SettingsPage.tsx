"use client";

import { useState } from "react";
import { ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { AppSettings } from "@/features/library/types";
import {
  AboutSettingsSection,
  EditingSettingsSection,
  ImportingSettingsSection,
  LinkingSettingsSection,
} from "@/features/settings/SettingsSections";
import { cn } from "@/lib/utils";

export interface SettingsPageProps {
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  onBack: () => void;
}

const sections = [
  { id: "importing", label: "importing", ordinal: "1" },
  { id: "editing", label: "editing", ordinal: "2" },
  { id: "linking", label: "linking", ordinal: "3" },
  { id: "about", label: "about" },
] as const;

type SettingsSectionId = (typeof sections)[number]["id"];

export default function SettingsPage({ settings, onChange, onBack }: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("importing");
  const activeSectionLabelId = `settings-section-${activeSection}`;

  return (
    <div className="min-h-0 flex-1 flex flex-col overflow-hidden">
      <div className="p-6 h-[104px] border-b flex-shrink-0 flex flex-col justify-center gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center text-brand/80 transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            onClick={onBack}
            aria-label="back to workspace"
          >
            <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} className="size-5" />
          </button>
          <h2 className="relative -top-px truncate text-lg font-semibold leading-tight">
            settings
          </h2>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav
          aria-label="settings sections"
          className="flex shrink-0 items-center gap-1 overflow-x-auto border-b p-2 sm:w-48 sm:flex-col sm:items-stretch sm:overflow-visible sm:border-r sm:border-b-0 sm:p-3"
        >
          {sections.map((section) => {
            const active = section.id === activeSection;

            return (
              <div key={section.id} className={cn(section.id === "about" && "contents sm:block")}>
                {section.id === "about" && (
                  <div
                    className="mx-1 h-7 w-px shrink-0 bg-border sm:my-2 sm:h-px sm:w-auto"
                    aria-hidden="true"
                  />
                )}
                <button
                  id={`settings-section-${section.id}`}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "flex min-h-11 w-auto shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-left text-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-9 sm:w-full",
                    active
                      ? "bg-secondary font-semibold text-secondary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span
                    className="hidden w-4 text-xs opacity-60 sm:inline-block"
                    aria-hidden="true"
                  >
                    {"ordinal" in section ? section.ordinal : ""}
                  </span>
                  {section.label}
                </button>
              </div>
            );
          })}
        </nav>
        <div
          role="region"
          aria-labelledby={activeSectionLabelId}
          className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6 lg:px-8"
        >
          {activeSection === "importing" && (
            <ImportingSettingsSection settings={settings} onChange={onChange} />
          )}
          {activeSection === "editing" && (
            <EditingSettingsSection settings={settings} onChange={onChange} />
          )}
          {activeSection === "linking" && (
            <LinkingSettingsSection settings={settings} onChange={onChange} />
          )}
          {activeSection === "about" && <AboutSettingsSection />}
        </div>
      </div>
    </div>
  );
}
