// PROTOTYPE: Three route-based options for the guided metadata cleanup experience from #81.
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  FileAudio,
  ListChecks,
  RotateCcw,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type Suggestion = {
  id: number;
  artist: string;
  before: string;
  after: string;
  filename: string;
  reason: string;
};

const suggestions: Suggestion[] = [
  {
    id: 1,
    artist: "Burial",
    before: "Burial - Archangel (Official Audio)",
    after: "Archangel",
    filename: "Archangel.mp3",
    reason: "artist name + video label",
  },
  {
    id: 2,
    artist: "Burial",
    before: "Burial - Near Dark [Official Audio]",
    after: "Near Dark",
    filename: "Near Dark.mp3",
    reason: "artist name + video label",
  },
  {
    id: 3,
    artist: "Burial",
    before: "Ghost Hardware (Visualizer)",
    after: "Ghost Hardware",
    filename: "Ghost Hardware.mp3",
    reason: "video label",
  },
  {
    id: 4,
    artist: "Burial",
    before: "Burial  —  Endorphin",
    after: "Endorphin",
    filename: "Endorphin.mp3",
    reason: "artist name + spacing",
  },
  {
    id: 5,
    artist: "Burial",
    before: "Raver (Official Video)",
    after: "Raver",
    filename: "Raver.mp3",
    reason: "video label",
  },
];

const routes = [
  { slug: "prompt", label: "A — Prompt + sheet" },
  { slug: "guided", label: "B — Guided review" },
  { slug: "inline", label: "C — Inline queue" },
];

function useCleanupState() {
  const [selected, setSelected] = useState(() => new Set(suggestions.map(({ id }) => id)));
  const [applied, setApplied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const apply = () => {
    if (selected.size) setApplied(true);
  };
  const undo = () => setApplied(false);
  return { selected, setSelected, applied, dismissed, setDismissed, toggle, apply, undo };
}

type CleanupState = ReturnType<typeof useCleanupState>;

function TrackChange({ item, compact = false }: { item: Suggestion; compact?: boolean }) {
  return (
    <div className={cn("min-w-0", compact ? "space-y-0.5" : "space-y-1.5")}>
      <p className="truncate text-sm text-muted-foreground line-through decoration-muted-foreground/60">
        {item.before}
      </p>
      <div className="flex min-w-0 items-center gap-2">
        <ArrowRight className="size-3.5 shrink-0 text-primary" />
        <p className="truncate text-sm font-medium">{item.after}</p>
      </div>
    </div>
  );
}

function AppliedNotice({ count, onUndo }: { count: number; onUndo: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-4" />
        </span>
        <div>
          <p className="text-sm font-semibold">Cleaned {count} track titles</p>
          <p className="text-xs text-muted-foreground">Titles and synced filenames were updated.</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onUndo}>
        <RotateCcw /> Undo
      </Button>
    </div>
  );
}

function AppChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-background pb-24 text-foreground">
      <header className="border-b bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="/" className="text-xl font-bold tracking-tight">
            tagium
          </a>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Untrue · Burial</span>
            <span className="rounded-full bg-muted px-2.5 py-1">13 tracks</span>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

function PromptVariant({ state }: { state: CleanupState }) {
  const [reviewing, setReviewing] = useState(false);
  if (state.dismissed) {
    return <EmptyEditor message="Suggestions dismissed. The metadata editor is unchanged." />;
  }
  return (
    <AppChrome>
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        {state.applied && <AppliedNotice count={state.selected.size} onUndo={state.undo} />}
        {!state.applied && (
          <section className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-sm">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                  <Sparkles className="size-5" />
                </span>
                <div>
                  <h1 className="text-lg font-semibold">
                    We found 5 titles that could be cleaned up
                  </h1>
                  <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                    Remove matching artist names and video labels. Nothing changes until you approve
                    it.
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="max-w-52 truncate text-muted-foreground line-through">
                      Burial - Archangel (Official Audio)
                    </span>
                    <ArrowRight className="size-3" />
                    <span className="font-medium">Archangel</span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-2 pl-15 sm:pl-0">
                <Button variant="ghost" onClick={() => state.setDismissed(true)}>
                  Not now
                </Button>
                <Button onClick={() => setReviewing(true)}>
                  Review cleanup <ChevronRight />
                </Button>
              </div>
            </div>
          </section>
        )}
        <EditorScaffold />
      </main>
      {reviewing && !state.applied && (
        <div
          className="fixed inset-0 z-20 flex items-end bg-black/45 sm:items-center sm:justify-center"
          onMouseDown={() => setReviewing(false)}
        >
          <section
            className="max-h-[88svh] w-full overflow-auto rounded-t-2xl bg-background p-5 shadow-2xl sm:max-w-2xl sm:rounded-2xl sm:p-6"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-primary">
                  Suggested cleanup
                </p>
                <h2 className="mt-1 text-xl font-semibold">Review 5 title changes</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Selected filenames will match the cleaned titles.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={() => setReviewing(false)}
              >
                <X />
              </Button>
            </div>
            <div className="divide-y rounded-xl border">
              {suggestions.map((item) => (
                <label
                  key={item.id}
                  className="flex cursor-pointer items-start gap-3 p-4 hover:bg-muted/40"
                >
                  <Checkbox
                    checked={state.selected.has(item.id)}
                    onCheckedChange={() => state.toggle(item.id)}
                    className="mt-1"
                  />
                  <TrackChange item={item} />
                </label>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <Button variant="ghost" onClick={() => state.setSelected(new Set())}>
                Clear all
              </Button>
              <Button
                disabled={!state.selected.size}
                onClick={() => {
                  state.apply();
                  setReviewing(false);
                }}
              >
                Apply {state.selected.size} changes
              </Button>
            </div>
          </section>
        </div>
      )}
    </AppChrome>
  );
}

function GuidedVariant({ state }: { state: CleanupState }) {
  const [step, setStep] = useState<"overview" | "review">("overview");
  if (state.dismissed)
    return <EmptyEditor message="Cleanup skipped. You can reopen it from the album menu." />;
  return (
    <AppChrome>
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        {state.applied ? (
          <div className="mx-auto max-w-xl space-y-5 pt-10 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-7" />
            </span>
            <div>
              <h1 className="text-2xl font-semibold">Your titles are cleaned up</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Updated {state.selected.size} tracks in Untrue. You can keep editing or undo.
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={state.undo}>
                <RotateCcw /> Undo
              </Button>
              <Button onClick={() => window.location.assign("/")}>Back to editor</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-7 flex items-center gap-3 text-xs font-medium text-muted-foreground">
              <span className="text-foreground">1 · Suggestions</span>
              <span className="h-px flex-1 bg-border" />
              <span className={step === "review" ? "text-foreground" : ""}>2 · Review</span>
            </div>
            {step === "overview" ? (
              <section>
                <span className="grid size-12 place-items-center rounded-2xl bg-primary/15 text-primary">
                  <WandSparkles className="size-6" />
                </span>
                <h1 className="mt-5 text-3xl font-semibold tracking-tight">
                  Make these titles music-library ready?
                </h1>
                <p className="mt-3 max-w-2xl text-muted-foreground">
                  Tagium found 5 confident fixes. Ambiguous titles stay exactly as they are.
                </p>
                <div className="mt-8 grid gap-3 sm:grid-cols-3">
                  <SummaryCard count="3" label="artist names" detail="removed from titles" />
                  <SummaryCard count="4" label="video labels" detail="removed when exact" />
                  <SummaryCard count="5" label="filenames" detail="kept in sync" />
                </div>
                <div className="mt-6 rounded-xl border bg-card p-4">
                  <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Example
                  </p>
                  <TrackChange item={suggestions[0]} />
                </div>
                <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                  <Button variant="ghost" onClick={() => state.setDismissed(true)}>
                    Skip cleanup
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStep("review")}>
                      Review each
                    </Button>
                    <Button onClick={state.apply}>Clean all 5 titles</Button>
                  </div>
                </div>
              </section>
            ) : (
              <section>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-3 mb-4"
                  onClick={() => setStep("overview")}
                >
                  <ArrowLeft /> Back
                </Button>
                <h1 className="text-2xl font-semibold">Choose which titles to clean</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  All confident suggestions are selected. Uncheck anything you want to keep.
                </p>
                <div className="mt-6 space-y-3">
                  {suggestions.map((item) => (
                    <label
                      key={item.id}
                      className={cn(
                        "flex cursor-pointer gap-4 rounded-xl border p-4 transition",
                        state.selected.has(item.id)
                          ? "border-primary/35 bg-primary/5"
                          : "opacity-60",
                      )}
                    >
                      <Checkbox
                        checked={state.selected.has(item.id)}
                        onCheckedChange={() => state.toggle(item.id)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <TrackChange item={item} />
                        <p className="mt-2 text-xs text-muted-foreground">
                          {item.reason} · filename → {item.filename}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="sticky bottom-3 mt-6 flex items-center justify-between rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
                  <span className="pl-2 text-sm text-muted-foreground">
                    {state.selected.size} of 5 selected
                  </span>
                  <Button disabled={!state.selected.size} onClick={state.apply}>
                    Apply cleanup
                  </Button>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </AppChrome>
  );
}

function InlineVariant({ state }: { state: CleanupState }) {
  const active = suggestions.filter((item) => state.selected.has(item.id));
  if (state.dismissed) return <EmptyEditor message="Cleanup suggestions hidden for this import." />;
  return (
    <AppChrome>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {state.applied && <AppliedNotice count={state.selected.size} onUndo={state.undo} />}
        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <EditorScaffold />
          {!state.applied && (
            <aside className="h-fit overflow-hidden rounded-2xl border bg-card shadow-sm lg:sticky lg:top-5">
              <div className="border-b bg-primary/8 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ListChecks className="size-4 text-primary" />
                    <h1 className="font-semibold">Cleanup queue</h1>
                  </div>
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                    {active.length}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Approve suggestions as you work. Only checked titles will change.
                </p>
              </div>
              <div className="max-h-[28rem] divide-y overflow-auto">
                {suggestions.map((item) => (
                  <div
                    key={item.id}
                    className={cn("p-4", !state.selected.has(item.id) && "opacity-45")}
                  >
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={state.selected.has(item.id)}
                        onCheckedChange={() => state.toggle(item.id)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="mb-2 truncate text-xs font-medium text-muted-foreground">
                          {item.artist} · {item.reason}
                        </p>
                        <TrackChange item={item} compact />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-2 border-t p-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked disabled /> Use cleaned titles as filenames
                </label>
                <Button className="w-full" disabled={!state.selected.size} onClick={state.apply}>
                  Apply {state.selected.size} approved changes
                </Button>
                <Button variant="ghost" className="w-full" onClick={() => state.setDismissed(true)}>
                  Dismiss suggestions
                </Button>
              </div>
            </aside>
          )}
        </div>
      </main>
    </AppChrome>
  );
}

function SummaryCard({ count, label, detail }: { count: string; label: string; detail: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-2xl font-semibold">{count}</p>
      <p className="mt-1 text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function EditorScaffold() {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <p className="font-semibold">Archangel</p>
          <p className="text-xs text-muted-foreground">Untrue · Burial</p>
        </div>
        <Button variant="outline" size="sm">
          Save track
        </Button>
      </div>
      <div className="grid min-h-80 sm:grid-cols-[13rem_1fr]">
        <div className="border-b bg-muted/30 p-3 sm:border-r sm:border-b-0">
          {["Archangel", "Near Dark", "Ghost Hardware", "Endorphin", "Raver"].map(
            (title, index) => (
              <div
                key={title}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                  index === 0 && "bg-background shadow-sm",
                )}
              >
                <FileAudio className="size-3.5 text-muted-foreground" />
                <span className="truncate">{title}</span>
              </div>
            ),
          )}
        </div>
        <div className="grid content-start gap-4 p-5 sm:grid-cols-2">
          {["title", "artist", "album", "genre", "year", "track"].map((label) => (
            <label key={label} className="space-y-1">
              <span className="text-xs font-medium">{label}</span>
              <div className="h-9 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
                {label === "artist"
                  ? "Burial"
                  : label === "album"
                    ? "Untrue"
                    : label === "title"
                      ? "Archangel"
                      : "—"}
              </div>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}

function EmptyEditor({ message }: { message: string }) {
  return (
    <AppChrome>
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between rounded-xl border bg-muted/40 p-4 text-sm">
          <span>{message}</span>
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            Reset prototype
          </Button>
        </div>
        <EditorScaffold />
      </main>
    </AppChrome>
  );
}

function RouteSwitcher({ current }: { current: string }) {
  const index = Math.max(
    0,
    routes.findIndex(({ slug }) => slug === current),
  );
  const go = (offset: number) => {
    const next = routes[(index + offset + routes.length) % routes.length];
    window.location.assign(`/prototype/metadata-cleanup/${next.slug}`);
  };
  return (
    <nav
      aria-label="Prototype variants"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/15 bg-neutral-950 p-1.5 text-white shadow-2xl"
    >
      <button
        className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-white/15 focus-visible:outline-2"
        onClick={() => go(-1)}
        aria-label="Previous option"
      >
        <ArrowLeft className="size-4" />
      </button>
      <span className="min-w-42 px-2 text-center text-xs font-medium">{routes[index].label}</span>
      <button
        className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-white/15 focus-visible:outline-2"
        onClick={() => go(1)}
        aria-label="Next option"
      >
        <ArrowRight className="size-4" />
      </button>
    </nav>
  );
}

export default function MetadataCleanupPrototype() {
  const slug = useMemo(
    () => window.location.pathname.split("/").filter(Boolean).at(-1) ?? "prompt",
    [],
  );
  const current = routes.some((route) => route.slug === slug) ? slug : "prompt";
  const state = useCleanupState();
  return (
    <>
      <div className="fixed right-3 top-16 z-50 rounded-full border bg-background/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground shadow-sm backdrop-blur">
        Prototype · Issue #81
      </div>
      {current === "guided" ? (
        <GuidedVariant state={state} />
      ) : current === "inline" ? (
        <InlineVariant state={state} />
      ) : (
        <PromptVariant state={state} />
      )}
      <RouteSwitcher current={current} />
    </>
  );
}
