"use client";

// PROTOTYPE — Three listening-guide layouts, switchable via ?variant=, mounted in the existing app shell.
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CirclePlay,
  Download,
  FileArchive,
  Headphones,
  Image,
  Laptop,
  Monitor,
  Music2,
  Play,
  Smartphone,
  Sparkles,
  Tablet,
} from "lucide-react";
import PrototypeSwitcher from "@/components/dev/PrototypeSwitcher";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const variants = [
  { key: "A", name: "guided picker" },
  { key: "B", name: "visual handbook" },
  { key: "C", name: "journey map" },
];

const destinations = [
  { key: "spotify-desktop", service: "Spotify", device: "desktop", icon: Monitor },
  { key: "spotify-ios", service: "Spotify", device: "iPhone / iPad", icon: Smartphone },
  { key: "spotify-android", service: "Spotify", device: "Android", icon: Smartphone },
  { key: "apple-desktop", service: "Apple Music", device: "Mac / Windows", icon: Laptop },
  { key: "apple-ios", service: "Apple Music", device: "iPhone / iPad", icon: Tablet },
] as const;

type DestinationKey = (typeof destinations)[number]["key"];

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

function PrototypeHeader({ eyebrow }: { eyebrow: string }) {
  const leavePrototype = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("prototype");
    url.searchParams.delete("variant");
    window.location.assign(url.toString());
  };

  return (
    <header className="flex h-[104px] shrink-0 items-center justify-between border-b px-5 md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-primary/80 hover:bg-accent hover:text-primary"
          onClick={leavePrototype}
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

function DestinationPicker({
  selected,
  onSelect,
  compact = false,
}: {
  selected: DestinationKey;
  onSelect: (destination: DestinationKey) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("grid gap-2", compact ? "grid-cols-1" : "sm:grid-cols-2 xl:grid-cols-5")}>
      {destinations.map((destination) => {
        const Icon = destination.icon;
        const isSelected = selected === destination.key;
        return (
          <button
            key={destination.key}
            type="button"
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors",
              isSelected
                ? "border-primary bg-primary/10 text-foreground"
                : "bg-card hover:bg-accent/50",
            )}
            onClick={() => onSelect(destination.key)}
          >
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-lg",
                isSelected ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{destination.service}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {destination.device}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function VariantA() {
  const [selected, setSelected] = useState<DestinationKey>("spotify-ios");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PrototypeHeader eyebrow="A · destination first" />
      <main className="flex-1 overflow-y-auto px-5 pb-28 pt-8 md:px-8">
        <div className="mx-auto max-w-6xl space-y-10">
          <section className="space-y-5">
            <div className="max-w-2xl space-y-2">
              <p className="text-sm font-medium text-primary">Choose where you listen</p>
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                Guide headline placeholder
              </h2>
              <p className="text-muted-foreground">
                Short orientation placeholder. One sentence about selecting a destination.
              </p>
            </div>
            <DestinationPicker selected={selected} onSelect={setSelected} />
          </section>

          <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-8">
              {["Prepare the files", "Move the files", "Find your music"].map((title, index) => (
                <article key={title} className="grid gap-4 sm:grid-cols-[3rem_minmax(0,1fr)]">
                  <div className="grid size-10 place-items-center rounded-full bg-primary font-semibold text-primary-foreground">
                    {index + 1}
                  </div>
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-lg font-semibold">{title} placeholder</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Two or three lines of instructional copy will go here. Keep the action
                        focused and easy to scan.
                      </p>
                    </div>
                    <PlaceholderMedia
                      kind={index === 1 ? "video" : "image"}
                      label={index === 1 ? "short video placeholder" : "screenshot placeholder"}
                      className={index === 1 ? "aspect-video" : "aspect-[16/8]"}
                    />
                  </div>
                </article>
              ))}
            </div>

            <aside className="h-fit space-y-4 rounded-xl border bg-card p-5 lg:sticky lg:top-0">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <h3 className="text-sm font-semibold">Before you start</h3>
              </div>
              <div className="space-y-3 text-sm text-muted-foreground">
                {[
                  "Requirement placeholder",
                  "File location placeholder",
                  "Account note placeholder",
                ].map((item) => (
                  <div key={item} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
              <Button variant="outline" className="w-full">
                Resource link placeholder <ArrowRight />
              </Button>
            </aside>
          </section>
        </div>
      </main>
    </div>
  );
}

function VariantB() {
  const [selected, setSelected] = useState<DestinationKey>("spotify-desktop");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PrototypeHeader eyebrow="B · handbook" />
      <div className="grid min-h-0 flex-1 md:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="hidden overflow-y-auto border-r bg-card/50 p-4 md:block">
          <p className="px-2 pb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Pick a guide
          </p>
          <DestinationPicker compact selected={selected} onSelect={setSelected} />
          <div className="my-5 border-t" />
          <nav className="space-y-1 text-sm">
            {["Overview", "Step one", "Step two", "Step three", "Troubleshooting"].map(
              (item, index) => (
                <button
                  key={item}
                  type="button"
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-2 text-left",
                    index === 0
                      ? "bg-accent font-medium"
                      : "text-muted-foreground hover:bg-accent/50",
                  )}
                >
                  {item} placeholder
                  {index === 0 && <ChevronRight className="size-4" />}
                </button>
              ),
            )}
          </nav>
        </aside>

        <main className="overflow-y-auto px-5 pb-28 pt-7 md:px-10 lg:px-14">
          <article className="mx-auto max-w-3xl">
            <div className="mb-5 md:hidden">
              <DestinationPicker selected={selected} onSelect={setSelected} />
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
      </div>
    </div>
  );
}

function VariantC() {
  const [selected, setSelected] = useState<DestinationKey>("apple-ios");
  const journey = [
    { icon: Download, label: "Download" },
    { icon: FileArchive, label: "Prepare" },
    { icon: Smartphone, label: "Transfer" },
    { icon: Headphones, label: "Listen" },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PrototypeHeader eyebrow="C · journey map" />
      <main className="flex-1 overflow-y-auto px-5 pb-28 pt-8 md:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary/15 text-primary">
              <Music2 className="size-6" />
            </span>
            <h2 className="text-3xl font-bold tracking-tight md:text-5xl">
              From Tagium to your headphones
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              Short journey-level introduction placeholder.
            </p>
          </div>

          <section className="my-10 grid grid-cols-2 gap-3 md:grid-cols-4">
            {journey.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.label} className="relative rounded-xl border bg-card p-4">
                  {index < journey.length - 1 && (
                    <ChevronRight className="absolute -right-5 top-1/2 z-10 hidden size-6 -translate-y-1/2 text-muted-foreground md:block" />
                  )}
                  <div className="mb-8 flex items-center justify-between">
                    <Icon className="size-5 text-primary" />
                    <span className="text-xs text-muted-foreground">0{index + 1}</span>
                  </div>
                  <p className="font-semibold">{step.label}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Step summary placeholder</p>
                </div>
              );
            })}
          </section>

          <section className="rounded-2xl border bg-card p-4 md:p-6">
            <div className="mb-6 flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div>
                <p className="text-sm font-semibold">Choose your destination</p>
                <p className="text-xs text-muted-foreground">
                  The journey adapts after this choice.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Play className="size-3.5" /> 3 visual steps placeholder
              </div>
            </div>
            <DestinationPicker selected={selected} onSelect={setSelected} />
          </section>

          <section className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
            <PlaceholderMedia
              kind="video"
              label="primary walkthrough placeholder"
              className="aspect-video min-h-64"
            />
            <div className="space-y-3">
              {["Open the destination app", "Enable the local library", "Confirm the track"].map(
                (step, index) => (
                  <button
                    key={step}
                    type="button"
                    className={cn(
                      "flex w-full cursor-pointer gap-3 rounded-xl border p-4 text-left",
                      index === 0 ? "border-primary bg-primary/10" : "bg-card hover:bg-accent/50",
                    )}
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                      {index + 1}
                    </span>
                    <span>
                      <span className="block text-sm font-semibold">{step} placeholder</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        Supporting detail placeholder.
                      </span>
                    </span>
                  </button>
                ),
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default function ListeningGuidePrototype() {
  const [access, setAccess] = useState<"checking" | "allowed" | "denied">(
    import.meta.env.DEV ? "allowed" : "checking",
  );
  const requestedVariant = new URLSearchParams(window.location.search).get("variant") ?? "A";
  const initialVariant = variants.some((variant) => variant.key === requestedVariant)
    ? requestedVariant
    : "A";
  const [variant, setVariant] = useState(initialVariant);

  useEffect(() => {
    if (import.meta.env.DEV) return;

    fetch("/api/dev/config", { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => setAccess(config?.deployEnv === "preview" ? "allowed" : "denied"))
      .catch(() => setAccess("denied"));
  }, []);

  const changeVariant = (nextVariant: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", nextVariant);
    window.history.replaceState({}, "", url);
    setVariant(nextVariant);
  };

  if (access !== "allowed") {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6 text-sm text-muted-foreground">
        {access === "checking" ? "loading prototype…" : "prototype unavailable"}
      </div>
    );
  }

  return (
    <>
      {variant === "A" && <VariantA />}
      {variant === "B" && <VariantB />}
      {variant === "C" && <VariantC />}
      <PrototypeSwitcher variants={variants} current={variant} onChange={changeVariant} />
    </>
  );
}
