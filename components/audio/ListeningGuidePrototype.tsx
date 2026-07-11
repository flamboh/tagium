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

interface ListeningGuideState {
  view: "wizard" | "guide";
  step: number;
  app: AppKey | null;
  device: DeviceKey | null;
  source: SourceKey | null;
}

const listeningGuideStorageKey = "tagium:listening-guide-prototype";
const initialListeningGuideState: ListeningGuideState = {
  view: "wizard",
  step: 0,
  app: null,
  device: null,
  source: null,
};

function loadListeningGuideState(): ListeningGuideState {
  if (typeof window === "undefined") return initialListeningGuideState;

  try {
    const storedState = JSON.parse(
      window.localStorage.getItem(listeningGuideStorageKey) ?? "null",
    ) as Partial<ListeningGuideState> | null;
    const app = appOptions.find((option) => option.key === storedState?.app)?.key ?? null;
    const device = deviceOptions.find((option) => option.key === storedState?.device)?.key ?? null;
    const source = sourceOptions.find((option) => option.key === storedState?.source)?.key ?? null;
    const step = storedState?.step === 1 || storedState?.step === 2 ? storedState.step : 0;
    const view = storedState?.view === "guide" && app && device && source ? "guide" : "wizard";

    return { view, step, app, device, source };
  } catch {
    return initialListeningGuideState;
  }
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
    <header className="flex h-[104px] shrink-0 flex-col justify-center gap-1 border-b p-6">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center text-primary/80 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          onClick={onBack}
          aria-label="back to editor"
        >
          <ArrowLeft className="size-5" />
        </button>
        <h1 className="relative -top-px truncate text-lg font-semibold leading-tight">
          how do i listen?
        </h1>
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
  className,
}: {
  icon?: LucideIcon;
  logo?: string;
  label: string;
  selected: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-24 cursor-pointer items-center gap-4 rounded-xl border p-4 text-left transition-colors",
        selected ? "border-primary bg-primary/10" : "bg-card hover:bg-accent/50",
        className,
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
  state,
  onChange,
  onComplete,
  onBack,
}: {
  state: ListeningGuideState;
  onChange: (state: ListeningGuideState) => void;
  onComplete: (setup: GuideSetup) => void;
  onBack: () => void;
}) {
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const canAdvance =
    (state.step === 0 && state.app !== null) ||
    (state.step === 1 && state.device !== null) ||
    (state.step === 2 && state.source !== null);

  useEffect(() => {
    questionHeadingRef.current?.focus();
  }, [state.step]);

  const advance = () => {
    if (state.step < 2) {
      if (canAdvance) onChange({ ...state, step: state.step + 1 });
      return;
    }

    if (state.app && state.device && state.source) {
      onComplete({ app: state.app, device: state.device, source: state.source });
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PrototypeHeader onBack={onBack} />
      <main className="flex-1 overflow-y-auto px-5 pb-16 pt-8 md:px-8">
        <section className="mx-auto max-w-3xl">
          <p className="sr-only" role="status" aria-live="polite">
            step {state.step + 1} of 3
          </p>
          <div className="mb-10 flex justify-center gap-2" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <span
                key={index}
                className={cn(
                  "size-2 rounded-full transition-colors",
                  index === state.step ? "bg-primary" : "bg-muted",
                )}
              />
            ))}
          </div>

          <div className="min-h-[34rem] sm:min-h-[17rem]">
            {state.step === 0 && (
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
                      selected={state.app === option.key}
                      className="h-[204px] flex-col justify-center gap-1 text-center"
                      onClick={() => {
                        onChange({ ...state, app: option.key, step: 1 });
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {state.step === 1 && (
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
                      selected={state.device === option.key}
                      onClick={() => {
                        onChange({ ...state, device: option.key, step: 2 });
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {state.step === 2 && (
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
                      selected={state.source === option.key}
                      onClick={() => {
                        if (state.app && state.device) {
                          onComplete({
                            app: state.app,
                            device: state.device,
                            source: option.key,
                          });
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-10 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={state.step === 0}
              onClick={() => onChange({ ...state, step: state.step - 1 })}
              aria-label="previous question"
            >
              <ArrowLeft />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={!canAdvance}
              onClick={advance}
              aria-label="next question"
            >
              <ArrowRight />
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}

function VisualHandbookGuide({
  setup,
  onBack,
  onNewSelection,
}: {
  setup: GuideSetup;
  onBack: () => void;
  onNewSelection: () => void;
}) {
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
            <div>
              <h2
                ref={guideHeadingRef}
                tabIndex={-1}
                className="text-3xl font-bold tracking-tight outline-none md:text-5xl"
              >
                {source} to {app} on {device}
              </h2>
              <button
                type="button"
                className="mt-2 cursor-pointer text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
                onClick={onNewSelection}
              >
                make new selection
              </button>
            </div>

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
  const [state, setState] = useState<ListeningGuideState>(loadListeningGuideState);

  useEffect(() => {
    window.localStorage.setItem(listeningGuideStorageKey, JSON.stringify(state));
  }, [state]);

  if (state.view === "wizard" || !state.app || !state.device || !state.source) {
    return (
      <ListeningGuideWizard
        state={state}
        onChange={setState}
        onComplete={(nextSetup) => {
          setState({ view: "guide", step: 2, ...nextSetup });
        }}
        onBack={onBack}
      />
    );
  }

  return (
    <VisualHandbookGuide
      setup={{ app: state.app, device: state.device, source: state.source }}
      onBack={onBack}
      onNewSelection={() => setState(initialListeningGuideState)}
    />
  );
}
