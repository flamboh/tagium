"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, CircleHelp, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  guideRoutes,
  type GuideRoute,
  type ServiceKey,
} from "@/features/listening-guide/listeningGuideContent";

const serviceOptions = [
  {
    key: "spotify" as const,
    label: "spotify",
    logo: "/brands/spotify.svg",
  },
  {
    key: "apple" as const,
    label: "apple music",
    logo: "/brands/applemusic.svg",
  },
  {
    key: "elsewhere" as const,
    label: "anywhere else",
    icon: FolderOpen,
  },
];

function ListeningGuideHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="flex h-[104px] shrink-0 items-center border-b px-6">
      <button
        type="button"
        className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center text-primary/80 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={onBack}
        aria-label="back to editor"
      >
        <ArrowLeft className="size-5" />
      </button>
      <h1 className="ml-2 min-w-0 truncate text-lg font-semibold leading-tight">
        how do i listen?
      </h1>
    </header>
  );
}

function RouteTitle({ route }: { route: GuideRoute }) {
  if (route.service === "elsewhere") return <>move your mp3s somewhere else</>;

  return (
    <>
      listen with {route.serviceLabel} on {route.destination}
    </>
  );
}

function GuideSections({ route }: { route: GuideRoute }) {
  return (
    <div>
      <section className="mt-9 border-y py-7">
        <h3 className="text-base font-semibold">before you start</h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{route.before}</p>
      </section>

      <div className="divide-y">
        {route.steps.map((step, index) => {
          const Icon = step.icon;

          return (
            <section key={step.title} id={`guide-step-${index + 1}`} className="scroll-mt-8 py-10">
              <Icon className="mb-4 size-7 text-foreground" />

              <div className="max-w-2xl">
                <h3 className="text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.body}</p>
                {step.image && (
                  <figure className="mt-6 overflow-hidden rounded-xl bg-muted">
                    <img
                      src={step.image.src}
                      alt={step.image.alt}
                      className="h-auto w-full object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                  </figure>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <section className="border-t py-8">
        <div className="flex items-start gap-3">
          <Check className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h3 className="font-semibold">check it worked</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{route.success}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function GuideFooter({ route }: { route: GuideRoute }) {
  return (
    <section className="border-t py-9">
      <div className="flex items-start gap-3">
        <CircleHelp className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div>
          <h3 className="font-semibold">if it doesn’t show up</h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{route.troubleshooting}</p>
        </div>
      </div>
    </section>
  );
}

function GuidedListeningGuide() {
  const [service, setService] = useState<ServiceKey | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<GuideRoute | null>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const serviceRoutes = guideRoutes.filter((route) => route.service === service);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [selectedRoute]);

  if (selectedRoute) {
    return (
      <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-20 pt-10 md:px-10">
        <article className="mx-auto max-w-3xl">
          <button
            type="button"
            className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setSelectedRoute(null)}
          >
            <ArrowLeft className="size-4" />
            change destination
          </button>
          <p className="text-sm font-medium text-primary">{selectedRoute.serviceLabel}</p>
          <h2 className="mt-2 max-w-2xl text-3xl font-bold tracking-tight md:text-5xl">
            <RouteTitle route={selectedRoute} />
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
            {selectedRoute.intro}
          </p>
          <GuideSections route={selectedRoute} />
          <GuideFooter route={selectedRoute} />
        </article>
      </main>
    );
  }

  return (
    <main ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 pb-20 pt-10 md:px-10">
      <section className="mx-auto max-w-3xl">
        <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight md:text-5xl">
          {service ? "what device do you listen on?" : "where do you listen?"}
        </h2>

        <div className="mt-9 grid gap-3">
          {!service &&
            serviceOptions.map((option) => {
              const Icon = "icon" in option ? option.icon : null;

              return (
                <button
                  key={option.key}
                  type="button"
                  className="group flex min-h-32 cursor-pointer items-center justify-between rounded-xl border bg-card p-5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    if (option.key === "elsewhere") {
                      setSelectedRoute(
                        guideRoutes.find((route) => route.id === "elsewhere") ?? null,
                      );
                    } else {
                      setService(option.key);
                    }
                  }}
                >
                  <span className="flex items-center gap-4">
                    <span className="grid size-11 shrink-0 place-items-center">
                      {"logo" in option ? (
                        <img src={option.logo} alt="" aria-hidden="true" className="size-8" />
                      ) : (
                        Icon && <Icon className="size-8" />
                      )}
                    </span>
                    <span className="font-semibold">{option.label}</span>
                  </span>
                  <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </button>
              );
            })}

          {service &&
            serviceRoutes.map((route) => {
              const Icon = route.icon;

              return (
                <button
                  key={route.id}
                  type="button"
                  className="group flex min-h-32 cursor-pointer items-center gap-4 rounded-xl border bg-card p-5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setSelectedRoute(route)}
                >
                  <span className="grid size-11 shrink-0 place-items-center">
                    <Icon className="size-8" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{route.shortDestination}</span>
                    {route.note && (
                      <span className="mt-1 block text-sm text-muted-foreground">{route.note}</span>
                    )}
                  </span>
                  <ChevronRight className="size-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </button>
              );
            })}
        </div>

        {service && (
          <Button variant="ghost" className="mt-6 -ml-3" onClick={() => setService(null)}>
            <ArrowLeft />
            back
          </Button>
        )}
      </section>
    </main>
  );
}

export default function ListeningGuide({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <ListeningGuideHeader onBack={onBack} />
      <GuidedListeningGuide />
    </div>
  );
}
