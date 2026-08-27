"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Cancel01Icon,
  Download01Icon,
  Refresh04Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { loaderCircleIcon } from "@/components/icons/loaderCircle";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import MediaUrlEntry, { type MediaUrlEntryController } from "@/shared/media-url/MediaUrlEntry";
import { TagiumBrand } from "@/shared/brand/TagiumBrand";
import {
  cobaltVideoCodecs,
  startVideoDownload,
  type CobaltPickerItem,
  type CobaltVideoDownloadRequest,
  type VideoDownloadCallbacks,
  type VideoDownloadPhase,
  type VideoDownloadProgress,
  type VideoDownloadResult,
  type VideoDownloadTask,
  type VideoFileDownloadResult,
  type VideoPickerDownloadResult,
} from "@/apps/tagium-save/download";
import {
  buildVideoDownloadRequest,
  getDownloadReadyAnnouncement,
  getVideoDownloadPhaseLabel,
  presentVideoDownloadFailure,
  updateVideoDownloadSettings,
  type VideoDownloadSettings,
  type VideoDownloadSettingsUpdate,
} from "@/apps/tagium-save/tagiumSaveModel";
import { cn } from "@/lib/utils";

/**
 * THESIS: one link becomes one downloadable file; this is a landing tool, not a dashboard.
 * OWN-WORLD: tagium's centered wordmark, quiet surfaces, square crimson controls, and shared URL
 * entry keep the page in the existing landing world. STORY: paste a link, optionally choose output
 * settings, select an item when needed, then download it from the short recent list. FIRST VIEWPORT:
 * the wordmark sits above the standalone URL form in the same narrow centered column, with settings
 * beside the URL field. FORM: a direct landing form with one compact popover and inline state rows.
 */

const modeOptions = [
  { value: "auto", label: "video with audio" },
  { value: "audio", label: "audio only" },
  { value: "mute", label: "video only" },
] as const satisfies ReadonlyArray<{
  value: VideoDownloadSettings["mode"];
  label: string;
}>;

const qualityOptions = [
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
] as const satisfies ReadonlyArray<{
  value: VideoDownloadSettings["quality"];
  label: string;
}>;

const containerOptions = [
  { value: "mp4", label: "mp4" },
  { value: "webm", label: "webm" },
  { value: "mkv", label: "mkv" },
] as const satisfies ReadonlyArray<{
  value: VideoDownloadSettings["container"];
  label: string;
}>;

const codecOptions = cobaltVideoCodecs.map((value) => ({
  value,
  label: value,
})) satisfies ReadonlyArray<{
  value: VideoDownloadSettings["codec"];
  label: string;
}>;

const audioFormatOptions = [
  { value: "best", label: "source" },
  { value: "opus", label: "opus" },
  { value: "mp3", label: "mp3" },
] as const satisfies ReadonlyArray<{
  value: VideoDownloadSettings["audioFormat"];
  label: string;
}>;

const initialSettings: VideoDownloadSettings = {
  mode: "auto",
  quality: "1080",
  container: "mp4",
  codec: "h264",
  audioFormat: "best",
};

type DownloadState =
  | { kind: "idle" }
  | { kind: "working"; phase: VideoDownloadPhase; progress: number | undefined }
  | { kind: "picker"; result: VideoPickerDownloadResult }
  | { kind: "error"; message: string; retryable: boolean };

type RecentDownload = {
  id: number;
  file: File;
  release: () => Promise<void>;
};

type CompletionAnnouncement = {
  id: number;
  filename: string;
};

type ActiveDownloadTask = Pick<VideoDownloadTask<VideoDownloadResult>, "abort">;

const maxRecentDownloads = 5;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

const validateSourceUrl = (value: string) => {
  if (!value) return "enter a media url";
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return null;
  } catch {
    // The shared media entry shows this message beside the field.
  }
  return "enter a complete http or https url";
};

const normaliseProgress = (progress: VideoDownloadProgress["progress"]) => {
  if (progress === undefined || !Number.isFinite(progress)) return undefined;
  const fraction = progress > 1 ? progress / 100 : progress;
  return Math.round(Math.max(0, Math.min(1, fraction)) * 100);
};

interface SelectFieldProps<Value extends string> {
  id: string;
  label: string;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: string }>;
  onChange: (value: Value) => void;
}

function SelectField<Value extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: SelectFieldProps<Value>) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id} className="mb-1.5 text-xs text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const option = options.find((candidate) => candidate.value === event.currentTarget.value);
          if (option) onChange(option.value);
        }}
        className="h-9 w-full cursor-pointer appearance-none rounded-md border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function DownloadSettings({
  settings,
  onChange,
  disabled,
}: {
  settings: VideoDownloadSettings;
  onChange: (update: VideoDownloadSettingsUpdate) => void;
  disabled: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0 rounded-lg"
          aria-label="download settings"
          disabled={disabled}
        >
          <HugeiconsIcon icon={Settings01Icon} strokeWidth={2} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            id="video-mode"
            label="mode"
            value={settings.mode}
            options={modeOptions}
            onChange={(value) => onChange({ key: "mode", value })}
          />
          <SelectField
            id="video-quality"
            label="quality"
            value={settings.quality}
            options={qualityOptions}
            onChange={(value) => onChange({ key: "quality", value })}
          />
          <SelectField
            id="video-container"
            label="container"
            value={settings.container}
            options={containerOptions}
            onChange={(value) => onChange({ key: "container", value })}
          />
          <SelectField
            id="video-codec"
            label="codec"
            value={settings.codec}
            options={codecOptions}
            onChange={(value) => onChange({ key: "codec", value })}
          />
          <SelectField
            id="video-audio"
            label="audio"
            value={settings.audioFormat}
            options={audioFormatOptions}
            onChange={(value) => onChange({ key: "audioFormat", value })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProgressRow({
  phase,
  progress,
  onCancel,
}: {
  phase: VideoDownloadPhase;
  progress: number | undefined;
  onCancel: () => void;
}) {
  return (
    <div className="mt-1 flex items-center gap-2" role="status" aria-live="polite">
      <HugeiconsIcon
        icon={loaderCircleIcon}
        strokeWidth={2}
        className="size-4 shrink-0 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
      <span className="w-20 shrink-0 text-xs text-muted-foreground">
        {getVideoDownloadPhaseLabel(phase)}
      </span>
      <div
        role="progressbar"
        aria-label="download progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={
          progress === undefined
            ? getVideoDownloadPhaseLabel(phase)
            : `${getVideoDownloadPhaseLabel(phase)} ${progress}%`
        }
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-lg bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-lg bg-primary transition-[width] motion-reduce:transition-none",
            progress === undefined && "w-1/3 animate-pulse",
          )}
          style={progress === undefined ? undefined : { width: `${progress}%` }}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        aria-label="cancel download"
        onClick={onCancel}
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden="true" />
      </Button>
    </div>
  );
}

function PickerChoices({
  result,
  onSelect,
  onSelectAudio,
  onReset,
}: {
  result: VideoPickerDownloadResult;
  onSelect: (item: CobaltPickerItem) => void;
  onSelectAudio: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-1 flex w-full items-start gap-2">
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2" aria-label="media choices">
        {result.picker.map((item, index) => (
          <Button
            key={`${item.type}-${item.url}`}
            type="button"
            variant="outline"
            className="h-9 min-w-0 justify-between px-3 text-xs"
            aria-label={`download ${item.type} ${index + 1}`}
            onClick={() => onSelect(item)}
          >
            <span className="truncate">{item.type}</span>
            <span aria-hidden="true">{index + 1}</span>
          </Button>
        ))}
        {result.downloadAudio && (
          <Button
            type="button"
            variant="outline"
            className="h-9 min-w-0 justify-between px-3 text-xs"
            aria-label={`download ${result.audioFilename ?? "audio"}`}
            onClick={onSelectAudio}
          >
            <span className="truncate">audio</span>
            <HugeiconsIcon
              icon={Download01Icon}
              strokeWidth={2}
              className="size-4 shrink-0"
              aria-hidden="true"
            />
          </Button>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        aria-label="reset download"
        onClick={onReset}
      >
        <HugeiconsIcon icon={Refresh04Icon} strokeWidth={2} aria-hidden="true" />
      </Button>
    </div>
  );
}

function RecentDownloadRow({
  download,
  onDownload,
}: {
  download: RecentDownload;
  onDownload: (file: File) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || prefersReducedMotion()) return;

    const reveal = content.animate(
      [
        { clipPath: "inset(0 0 100% 0)", opacity: 0, transform: "translateY(-28px)" },
        { clipPath: "inset(0 0 0 0)", opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 300, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );

    return () => reveal.cancel();
  }, [download.id]);

  return (
    <li className="h-10 overflow-hidden" data-save-download-item>
      <div ref={contentRef} className="flex h-10 min-w-0 items-center gap-2 pl-3">
        <span className="min-w-0 flex-1 truncate text-sm" title={download.file.name}>
          {download.file.name}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 shrink-0"
          aria-label={`download ${download.file.name}`}
          onClick={() => onDownload(download.file)}
        >
          <HugeiconsIcon icon={Download01Icon} strokeWidth={2} aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

function RecentDownloads({
  downloads,
  onDownload,
}: {
  downloads: ReadonlyArray<RecentDownload>;
  onDownload: (file: File) => void;
}) {
  if (downloads.length === 0) return null;

  return (
    <ul className="relative z-0 ml-12 w-[calc(100%-3rem)]" aria-label="recent downloads">
      {downloads.map((download) => (
        <RecentDownloadRow key={download.id} download={download} onDownload={onDownload} />
      ))}
    </ul>
  );
}

function ErrorRow({
  message,
  onRetry,
  onReset,
}: {
  message: string;
  onRetry?: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-1 flex min-w-0 items-start gap-2 text-xs text-destructive" role="alert">
      <span className="min-w-0 flex-1 break-words pt-2">{message}</span>
      {onRetry && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-destructive hover:text-destructive"
          aria-label="retry download"
          onClick={onRetry}
        >
          <HugeiconsIcon icon={Refresh04Icon} strokeWidth={2} aria-hidden="true" />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0 text-destructive hover:text-destructive"
        aria-label="reset download"
        onClick={onReset}
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden="true" />
      </Button>
    </div>
  );
}

const downloadFile = (file: File) => {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export default function TagiumSaveApp({
  startDownload = startVideoDownload,
}: {
  startDownload?: typeof startVideoDownload;
} = {}) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [settings, setSettings] = useState(initialSettings);
  const [state, setState] = useState<DownloadState>({ kind: "idle" });
  const [recentDownloads, setRecentDownloads] = useState<ReadonlyArray<RecentDownload>>([]);
  const [completionAnnouncement, setCompletionAnnouncement] =
    useState<CompletionAnnouncement | null>(null);
  const operationRef = useRef(0);
  const nextDownloadIdRef = useRef(0);
  const activeTaskRef = useRef<ActiveDownloadTask | null>(null);
  const recentDownloadsRef = useRef<ReadonlyArray<RecentDownload>>([]);
  const lastRequestRef = useRef<{
    request: CobaltVideoDownloadRequest;
    sourceUrl: string;
  } | null>(null);

  useEffect(
    () => () => {
      operationRef.current += 1;
      activeTaskRef.current?.abort();
      activeTaskRef.current = null;
      const downloads = recentDownloadsRef.current;
      recentDownloadsRef.current = [];
      for (const download of downloads) void download.release();
    },
    [],
  );

  const callbacksFor = (operation: number): VideoDownloadCallbacks => ({
    onProgress: (event) => {
      if (operationRef.current !== operation) return;
      const progress = normaliseProgress(event.progress);
      setState((current) =>
        current.kind === "working" ? { ...current, phase: event.phase, progress } : current,
      );
    },
  });

  const completeDownload = (operation: number, result: VideoFileDownloadResult) => {
    if (operationRef.current !== operation) {
      void result.release();
      return;
    }
    nextDownloadIdRef.current += 1;
    const download = {
      id: nextDownloadIdRef.current,
      file: result.file,
      release: result.release,
    };
    const nextDownloads = [download, ...recentDownloadsRef.current];
    const retainedDownloads = nextDownloads.slice(0, maxRecentDownloads);
    recentDownloadsRef.current = retainedDownloads;
    setRecentDownloads(retainedDownloads);
    for (const removed of nextDownloads.slice(maxRecentDownloads)) void removed.release();
    setCompletionAnnouncement({ id: download.id, filename: download.file.name });
    setSourceUrl("");
    setState({ kind: "idle" });
  };

  const runRequest = async (request: CobaltVideoDownloadRequest, source: string): Promise<void> => {
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    activeTaskRef.current?.abort();
    lastRequestRef.current = { request, sourceUrl: source };
    setValidationError(null);
    setState({ kind: "working", phase: "planning", progress: undefined });

    const task = startDownload(request, callbacksFor(operation));
    activeTaskRef.current = task;
    try {
      const result = await task.promise;
      if (operationRef.current !== operation) {
        if (result.status === "file") void result.release();
        return;
      }
      if (result.status === "picker") {
        setState({ kind: "picker", result });
        return;
      }
      completeDownload(operation, result);
    } catch (error) {
      if (operationRef.current !== operation) return;
      const failure = presentVideoDownloadFailure(
        error instanceof Error ? error : new Error("download failed."),
      );
      setState({
        kind: "error",
        message: failure.trackDescription,
        retryable: failure.retryable,
      });
    } finally {
      if (operationRef.current === operation) activeTaskRef.current = null;
    }
  };

  const runPickerDownload = async (
    startDownload: (
      callbacks: VideoDownloadCallbacks,
    ) => VideoDownloadTask<VideoFileDownloadResult>,
  ) => {
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    activeTaskRef.current?.abort();
    setState({ kind: "working", phase: "downloading", progress: undefined });

    const task = startDownload(callbacksFor(operation));
    activeTaskRef.current = task;
    try {
      const result = await task.promise;
      completeDownload(operation, result);
    } catch (error) {
      if (operationRef.current !== operation) return;
      const failure = presentVideoDownloadFailure(
        error instanceof Error ? error : new Error("download failed."),
      );
      setState({
        kind: "error",
        message: failure.trackDescription,
        retryable: failure.retryable,
      });
    } finally {
      if (operationRef.current === operation) activeTaskRef.current = null;
    }
  };

  const runPickerItem = (picker: VideoPickerDownloadResult, item: CobaltPickerItem) =>
    runPickerDownload((callbacks) => picker.download(item, callbacks));

  const runPickerAudio = (picker: VideoPickerDownloadResult) => {
    if (!picker.downloadAudio) return Promise.resolve();
    return runPickerDownload(picker.downloadAudio);
  };

  const submit = async (): Promise<boolean> => {
    if (activeTaskRef.current || state.kind === "picker") return true;
    const trimmedUrl = sourceUrl.trim();
    const localError = validateSourceUrl(trimmedUrl);
    if (localError) {
      setValidationError(localError);
      return false;
    }

    await runRequest(buildVideoDownloadRequest(trimmedUrl, settings), trimmedUrl);
    return true;
  };

  const controller: MediaUrlEntryController = {
    sourceUrl,
    submitting: state.kind === "working" || state.kind === "picker",
    validationError,
    setSourceUrl: (value) => {
      setSourceUrl(value);
      setValidationError(null);
    },
    submit,
  };

  const cancel = () => {
    if (state.kind !== "working") return;
    operationRef.current += 1;
    activeTaskRef.current?.abort();
    activeTaskRef.current = null;
    setState({ kind: "idle" });
  };

  const reset = () => {
    operationRef.current += 1;
    activeTaskRef.current?.abort();
    activeTaskRef.current = null;
    setValidationError(null);
    setSourceUrl("");
    setState({ kind: "idle" });
  };

  const retry = () => {
    const lastRequest = lastRequestRef.current;
    if (!lastRequest || activeTaskRef.current) return;
    setSourceUrl(lastRequest.sourceUrl);
    setValidationError(null);
    void runRequest(lastRequest.request, lastRequest.sourceUrl);
  };

  return (
    <main className="flex h-svh min-h-0 flex-col items-center justify-center overflow-y-auto p-8 max-lg:[@media(max-height:700px)]:p-4">
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {completionAnnouncement && (
          <span key={completionAnnouncement.id}>
            {getDownloadReadyAnnouncement(completionAnnouncement.filename)}
          </span>
        )}
      </span>
      <div className="flex w-full max-w-md flex-col items-center gap-10 max-lg:[@media(max-height:700px)]:gap-6">
        <TagiumBrand product="save" showTagline={false} />

        <div className="h-14 w-full shrink-0" data-save-download-stage>
          <div className="w-full">
            <div className="relative z-10 bg-background">
              <MediaUrlEntry
                layout="standalone"
                controller={controller}
                leadingAction={
                  <DownloadSettings
                    settings={settings}
                    disabled={state.kind === "working" || state.kind === "picker"}
                    onChange={(update) =>
                      setSettings((current) => updateVideoDownloadSettings(current, update))
                    }
                  />
                }
                placeholder="paste a media link"
                submitAriaLabel="start video download"
              />
            </div>

            <div className="flow-root h-9" data-save-download-progress-slot>
              {state.kind === "working" && (
                <ProgressRow phase={state.phase} progress={state.progress} onCancel={cancel} />
              )}
            </div>
            {state.kind === "error" && (
              <ErrorRow
                message={state.message}
                onRetry={state.retryable ? retry : undefined}
                onReset={reset}
              />
            )}

            {state.kind === "picker" && (
              <PickerChoices
                result={state.result}
                onSelect={(item) => void runPickerItem(state.result, item)}
                onSelectAudio={() => void runPickerAudio(state.result)}
                onReset={reset}
              />
            )}

            <RecentDownloads downloads={recentDownloads} onDownload={downloadFile} />
          </div>
        </div>
      </div>
    </main>
  );
}
