"use client";

// PROTOTYPE — Entry wizard feeding the selected right-rail handbook layout in the existing app shell.
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CirclePlay,
  FolderOpen,
  Image,
  Monitor,
  MonitorSmartphone,
  Smartphone,
  Tablet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const appOptions = [
  { key: "spotify", label: "spotify", logo: "/brands/spotify.svg" },
  { key: "apple-music", label: "apple music", logo: "/brands/applemusic.svg" },
] as const;

const deviceOptions = [
  { key: "computer", label: "computer", icon: Monitor },
  { key: "iphone-ipad", label: "iphone / ipad", icon: Tablet },
  { key: "android", label: "android", icon: Smartphone },
  { key: "computer-mobile", label: "computer + phone / tablet", icon: MonitorSmartphone },
] as const;

const sourceOptions = [
  { key: "soundcloud", label: "soundcloud", logo: "/brands/soundcloud.svg" },
  { key: "youtube", label: "youtube", logo: "/brands/youtube.svg" },
  {
    key: "local-files",
    label: "local files",
    icon: FolderOpen,
  },
] as const;

type AppKey = (typeof appOptions)[number]["key"];
type DeviceKey = (typeof deviceOptions)[number]["key"];
type SourceKey = (typeof sourceOptions)[number]["key"];

interface GuideSetup {
  app: AppKey;
  device: DeviceKey;
  source: SourceKey;
}

function PlaceholderMedia({
  kind = "image",
  label = "image",
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
        <span className="text-xs font-medium tracking-widest">{label}</span>
      </div>
    </div>
  );
}

function PrototypeHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="flex h-[104px] shrink-0 items-center justify-between border-b px-5 md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-primary/80 hover:bg-accent hover:text-primary"
          onClick={onBack}
          aria-label="close listening guide"
        >
          <X className="size-5" />
        </button>
        <h1 className="truncate text-lg font-semibold">how do i listen?</h1>
      </div>
    </header>
  );
}

function OptionCard({
  icon: Icon,
  logo,
  label,
  selected,
  onClick,
}: {
  icon?: LucideIcon;
  logo?: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-24 cursor-pointer items-center gap-4 rounded-xl border p-4 text-left transition-colors",
        selected ? "border-primary bg-primary/10" : "bg-card hover:bg-accent/50",
      )}
      onClick={onClick}
    >
      <span
        className={cn(
          "grid size-11 shrink-0 place-items-center rounded-xl",
          logo ? "bg-transparent" : selected ? "bg-primary text-primary-foreground" : "bg-muted",
        )}
      >
        {logo ? (
          <img src={logo} alt="" className="size-8" aria-hidden="true" />
        ) : (
          Icon && <Icon className="size-5" />
        )}
      </span>
      <span className="font-semibold">{label}</span>
    </button>
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
  const [device, setDevice] = useState<DeviceKey | null>(null);
  const [source, setSource] = useState<SourceKey | null>(null);
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const canAdvance =
    (step === 0 && app !== null) ||
    (step === 1 && device !== null) ||
    (step === 2 && source !== null);

  useEffect(() => {
    questionHeadingRef.current?.focus();
  }, [step]);

  const advance = () => {
    if (step < 2) {
      if (canAdvance) setStep((current) => current + 1);
      return;
    }

    if (app && device && source) onComplete({ app, device, source });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PrototypeHeader onBack={onBack} />
      <main className="flex-1 overflow-y-auto px-5 pb-16 pt-8 md:px-8">
        <section className="mx-auto max-w-3xl">
          <p className="sr-only" role="status" aria-live="polite">
            step {step + 1} of 3
          </p>
          <div className="mb-10 flex justify-center gap-2" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className={cn(
                  "size-2 rounded-full transition-colors",
                  index === step ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>

          {step === 0 && (
            <div>
              <h2
                ref={questionHeadingRef}
                tabIndex={-1}
                className="text-3xl font-bold tracking-tight outline-none md:text-4xl"
              >
                what app do you use?
              </h2>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {appOptions.map((option) => (
                  <OptionCard
                    key={option.key}
                    logo={option.logo}
                    label={option.label}
                    selected={app === option.key}
                    onClick={() => {
                      setApp(option.key);
                      setStep(1);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2
                ref={questionHeadingRef}
                tabIndex={-1}
                className="text-3xl font-bold tracking-tight outline-none md:text-4xl"
              >
                where do you want to listen?
              </h2>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {deviceOptions.map((option) => (
                  <OptionCard
                    key={option.key}
                    icon={option.icon}
                    label={option.label}
                    selected={device === option.key}
                    onClick={() => {
                      setDevice(option.key);
                      setStep(2);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2
                ref={questionHeadingRef}
                tabIndex={-1}
                className="text-3xl font-bold tracking-tight outline-none md:text-4xl"
              >
                where is your music?
              </h2>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {sourceOptions.map((option) => (
                  <OptionCard
                    key={option.key}
                    icon={"icon" in option ? option.icon : undefined}
                    logo={"logo" in option ? option.logo : undefined}
                    label={option.label}
                    selected={source === option.key}
                    onClick={() => {
                      setSource(option.key);
                      if (app && device) onComplete({ app, device, source: option.key });
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="mt-10 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={step === 0}
              onClick={() => setStep((current) => current - 1)}
              aria-label="previous question"
            >
              <ArrowLeft />
            </Button>
            {canAdvance ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={advance}
                aria-label="next question"
              >
                <ArrowRight />
              </Button>
            ) : (
              <span className="size-9" aria-hidden="true" />
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function VisualHandbookGuide({ setup, onBack }: { setup: GuideSetup; onBack: () => void }) {
  const app = appOptions.find((option) => option.key === setup.app)?.label;
  const device = deviceOptions.find((option) => option.key === setup.device)?.label;
  const source = sourceOptions.find((option) => option.key === setup.source)?.label;
  const sections = ["overview", "first section", "second section", "final section"];
  const guideHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    guideHeadingRef.current?.focus();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PrototypeHeader onBack={onBack} />
      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,1fr)_14rem]">
        <main className="overflow-y-auto px-5 pb-28 pt-7 md:px-10 lg:px-14">
          <article id="guide-overview" className="mx-auto max-w-3xl scroll-mt-8">
            <h2
              ref={guideHeadingRef}
              tabIndex={-1}
              className="text-3xl font-bold tracking-tight outline-none md:text-5xl"
            >
              {source} to {app} on {device}
            </h2>

            <PlaceholderMedia kind="video" label="video" className="my-10 aspect-video min-h-0" />

            {["first section", "second section", "final section"].map((section, index) => (
              <section
                key={section}
                id={`guide-section-${index + 1}`}
                className="scroll-mt-8 border-t py-9"
              >
                <div className="mb-5 flex items-start gap-4">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-sm font-semibold">
                    {index + 1}
                  </span>
                  <h3 className="text-xl font-semibold">{section}</h3>
                </div>
                {index !== 1 && <PlaceholderMedia label="image" className="aspect-[16/7]" />}
              </section>
            ))}
          </article>
        </main>

        <aside className="hidden overflow-y-auto px-5 py-8 md:block">
          <nav className="sticky top-0 space-y-1 text-sm" aria-label="guide sections">
            {sections.map((item, index) => (
              <a
                key={item}
                href={index === 0 ? "#guide-overview" : `#guide-section-${index}`}
                className={cn(
                  "block w-full cursor-pointer py-2 text-left transition-colors",
                  index === 0
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item}
              </a>
            ))}
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

  return <VisualHandbookGuide setup={setup} onBack={onBack} />;
}
