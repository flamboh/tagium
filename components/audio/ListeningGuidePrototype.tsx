"use client";

// PROTOTYPE — Entry wizard feeding the selected right-rail handbook layout in the existing app shell.
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CirclePlay,
  Cloud,
  FolderOpen,
  Globe2,
  Headphones,
  Image,
  Monitor,
  Music2,
  Smartphone,
  Sparkles,
  Tablet,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const appOptions = [
  { key: "spotify", label: "Spotify", detail: "App detail placeholder", icon: Headphones },
  { key: "apple-music", label: "Apple Music", detail: "App detail placeholder", icon: Music2 },
  { key: "other", label: "Something else", detail: "App detail placeholder", icon: Sparkles },
] as const;

const deviceOptions = [
  { key: "computer", label: "Computer", detail: "Mac or Windows", icon: Monitor },
  { key: "iphone-ipad", label: "iPhone / iPad", detail: "iOS or iPadOS", icon: Tablet },
  { key: "android", label: "Android", detail: "Phone or tablet", icon: Smartphone },
] as const;

const sourceOptions = [
  { key: "soundcloud", label: "SoundCloud", detail: "Source detail placeholder", icon: Cloud },
  { key: "youtube", label: "YouTube", detail: "Source detail placeholder", icon: Video },
  {
    key: "local-files",
    label: "Files I already have",
    detail: "Source detail placeholder",
    icon: FolderOpen,
  },
  { key: "other", label: "Somewhere else", detail: "Source detail placeholder", icon: Globe2 },
] as const;

type AppKey = (typeof appOptions)[number]["key"];
type DeviceKey = (typeof deviceOptions)[number]["key"];
type SourceKey = (typeof sourceOptions)[number]["key"];

interface GuideSetup {
  app: AppKey;
  devices: DeviceKey[];
  source: SourceKey;
}

function PlaceholderMedia({
  kind = "image",
  label = "media placeholder",
  className,
}: {
  kind?: "image" | "video";
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative grid min-h-48 place-items-center overflow-hidden rounded-xl border bg-[linear-gradient(135deg,var(--muted),transparent_70%)]",
        className,
      )}
    >
      <div className="absolute inset-3 rounded-lg border border-dashed border-foreground/15" />
      <div className="relative flex flex-col items-center gap-2 text-muted-foreground">
        {kind === "video" ? <CirclePlay className="size-10" /> : <Image className="size-10" />}
        <span className="text-xs font-medium uppercase tracking-widest">{label}</span>
      </div>
    </div>
  );
}

function PrototypeHeader({ eyebrow, onBack }: { eyebrow: string; onBack: () => void }) {
  return (
    <header className="flex h-[104px] shrink-0 items-center justify-between border-b px-5 md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-primary/80 hover:bg-accent hover:text-primary"
          onClick={onBack}
          aria-label="leave listening guide prototype"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            {eyebrow}
          </p>
          <h1 className="truncate text-lg font-semibold">Listening guide placeholder</h1>
        </div>
      </div>
      <span className="hidden rounded-full border px-3 py-1 text-xs text-muted-foreground sm:inline-flex">
        prototype only
      </span>
    </header>
  );
}

function OptionCard({
  icon: Icon,
  label,
  detail,
  selected,
  onClick,
  multiple = false,
}: {
  icon: LucideIcon;
  label: string;
  detail: string;
  selected: boolean;
  onClick: () => void;
  multiple?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "relative flex min-h-28 cursor-pointer items-start gap-4 rounded-xl border p-4 text-left transition-colors",
        selected ? "border-primary bg-primary/10" : "bg-card hover:bg-accent/50",
      )}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-xl",
          selected ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 pt-0.5">
        <span className="block font-semibold">{label}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{detail}</span>
      </span>
      <span
        className={cn(
          "absolute right-3 top-3 grid size-5 place-items-center border",
          multiple ? "rounded-md" : "rounded-full",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-foreground/20",
        )}
      >
        {selected && <Check className="size-3" />}
      </span>
    </button>
  );
}

function SetupSummary({ setup, onEdit }: { setup: GuideSetup; onEdit: () => void }) {
  const app = appOptions.find((option) => option.key === setup.app);
  const source = sourceOptions.find((option) => option.key === setup.source);
  const devices = setup.devices
    .map((key) => deviceOptions.find((option) => option.key === key)?.label)
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex flex-col justify-between gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {[
          ["Listen with", app?.label],
          ["On", devices],
          ["Music from", source?.label],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onEdit}>
        change answers
      </Button>
    </div>
  );
}

function ListeningGuideWizard({
  onComplete,
  onBack,
}: {
  onComplete: (setup: GuideSetup) => void;
  onBack: () => void;
}) {
  const [step, setStep] = useState(0);
  const [app, setApp] = useState<AppKey | null>(null);
  const [devices, setDevices] = useState<DeviceKey[]>([]);
  const [source, setSource] = useState<SourceKey | null>(null);
  const steps = ["Listening app", "Devices", "Music source"];

  const toggleDevice = (device: DeviceKey) => {
    setDevices((current) =>
      current.includes(device) ? current.filter((item) => item !== device) : [...current, device],
    );
  };

  const canContinue = (step === 0 && app !== null) || (step === 1 && devices.length > 0);
  const canFinish = step === 2 && app !== null && devices.length > 0 && source !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PrototypeHeader eyebrow="personalized guide wizard" onBack={onBack} />
      <main className="flex-1 overflow-y-auto px-5 pb-16 pt-8 md:px-8">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <section>
            <div className="mb-10 flex items-center gap-2" aria-label={`step ${step + 1} of 3`}>
              {steps.map((label, index) => (
                <div key={label} className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                      index <= step
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {index < step ? <Check className="size-3.5" /> : index + 1}
                  </span>
                  <span className="hidden truncate text-xs text-muted-foreground sm:block">
                    {label}
                  </span>
                  {index < steps.length - 1 && <span className="h-px flex-1 bg-border" />}
                </div>
              ))}
            </div>

            {step === 0 && (
              <div>
                <p className="text-sm font-medium text-primary">Question 1 of 3</p>
                <h2 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
                  What app do you use?
                </h2>
                <p className="mt-2 text-muted-foreground">Helper text placeholder.</p>
                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  {appOptions.map((option) => (
                    <OptionCard
                      key={option.key}
                      icon={option.icon}
                      label={option.label}
                      detail={option.detail}
                      selected={app === option.key}
                      onClick={() => setApp(option.key)}
                    />
                  ))}
                </div>
              </div>
            )}

            {step === 1 && (
              <div>
                <p className="text-sm font-medium text-primary">Question 2 of 3</p>
                <h2 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
                  Where do you want to listen?
                </h2>
                <p className="mt-2 text-muted-foreground">Choose every device that applies.</p>
                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  {deviceOptions.map((option) => (
                    <OptionCard
                      key={option.key}
                      icon={option.icon}
                      label={option.label}
                      detail={option.detail}
                      multiple
                      selected={devices.includes(option.key)}
                      onClick={() => toggleDevice(option.key)}
                    />
                  ))}
                </div>
              </div>
            )}

            {step === 2 && (
              <div>
                <p className="text-sm font-medium text-primary">Question 3 of 3</p>
                <h2 className="mt-2 text-3xl font-bold tracking-tight md:text-4xl">
                  Where is your music now?
                </h2>
                <p className="mt-2 text-muted-foreground">Choose the main source for this guide.</p>
                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  {sourceOptions.map((option) => (
                    <OptionCard
                      key={option.key}
                      icon={option.icon}
                      label={option.label}
                      detail={option.detail}
                      selected={source === option.key}
                      onClick={() => setSource(option.key)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="mt-10 flex items-center justify-between border-t pt-5">
              <Button
                type="button"
                variant="ghost"
                disabled={step === 0}
                onClick={() => setStep((current) => current - 1)}
              >
                <ArrowLeft /> back
              </Button>
              {step < 2 ? (
                <Button
                  type="button"
                  disabled={!canContinue}
                  onClick={() => setStep((current) => current + 1)}
                >
                  continue <ArrowRight />
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={!canFinish}
                  onClick={() => {
                    if (app && source && devices.length > 0) onComplete({ app, devices, source });
                  }}
                >
                  build my guide <ArrowRight />
                </Button>
              )}
            </div>
          </section>

          <aside className="h-fit rounded-xl border bg-card p-5 lg:sticky lg:top-0">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Your answers
            </p>
            <div className="mt-5 space-y-5 text-sm">
              <div>
                <p className="text-muted-foreground">App</p>
                <p className="mt-1 font-semibold">
                  {appOptions.find((option) => option.key === app)?.label ?? "Not selected"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Devices</p>
                <p className="mt-1 font-semibold">
                  {devices.length > 0
                    ? devices
                        .map((key) => deviceOptions.find((option) => option.key === key)?.label)
                        .join(", ")
                    : "Not selected"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Music source</p>
                <p className="mt-1 font-semibold">
                  {sourceOptions.find((option) => option.key === source)?.label ?? "Not selected"}
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

interface GuideVariantProps {
  setup: GuideSetup;
  onEditSetup: () => void;
  onBack: () => void;
}

function VisualHandbookGuide({ setup, onEditSetup, onBack }: GuideVariantProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PrototypeHeader eyebrow="visual handbook" onBack={onBack} />
      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_14rem]">
        <main className="overflow-y-auto px-5 pb-28 pt-7 md:px-10 lg:px-14">
          <article className="mx-auto max-w-3xl">
            <div className="mb-8">
              <SetupSummary setup={setup} onEdit={onEditSetup} />
            </div>
            <div className="mb-8 flex items-center gap-2 text-sm text-muted-foreground">
              <BookOpen className="size-4" /> Visual handbook placeholder
            </div>
            <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
              Article title placeholder for the selected path
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
              Intro paragraph placeholder. This layout treats the guide like calm, familiar product
              documentation with visual proof close to each instruction.
            </p>

            <PlaceholderMedia
              kind="video"
              label="overview video placeholder"
              className="my-10 aspect-video min-h-0"
            />

            {["First section", "Second section", "Final section"].map((section, index) => (
              <section key={section} className="border-t py-9">
                <div className="mb-5 flex items-start gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-sm font-semibold">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-xl font-semibold">{section} heading placeholder</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Instructional paragraph placeholder with enough vertical space to judge
                      reading rhythm and media placement.
                    </p>
                  </div>
                </div>
                {index !== 1 && (
                  <PlaceholderMedia
                    label="annotated screenshot placeholder"
                    className="aspect-[16/7]"
                  />
                )}
              </section>
            ))}
          </article>
        </main>

        <aside className="hidden overflow-y-auto px-5 py-8 md:block">
          <nav className="sticky top-0 space-y-1 text-sm" aria-label="guide sections">
            {["Overview", "Step one", "Step two", "Step three", "Troubleshooting"].map(
              (item, index) => (
                <button
                  key={item}
                  type="button"
                  className={cn(
                    "block w-full cursor-pointer py-2 text-left transition-colors",
                    index === 0
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item} placeholder
                </button>
              ),
            )}
          </nav>
        </aside>
      </div>
    </div>
  );
}

export default function ListeningGuidePrototype({ onBack }: { onBack: () => void }) {
  const [setup, setSetup] = useState<GuideSetup | null>(null);

  if (!setup) {
    return <ListeningGuideWizard onComplete={setSetup} onBack={onBack} />;
  }

  return <VisualHandbookGuide setup={setup} onEditSetup={() => setSetup(null)} onBack={onBack} />;
}
