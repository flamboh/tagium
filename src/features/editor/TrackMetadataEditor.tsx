"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode, RefObject, TransitionEvent } from "react";
import {
  Controller,
  useFormState,
  useWatch,
  type Control,
  type FieldErrors,
  type SubmitHandler,
  type UseFormGetValues,
  type UseFormSetError,
  type UseFormClearErrors,
  type UseFormSetFocus,
  type UseFormRegister,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import CoverArt from "@/features/editor/coverArt";
import { isValidFilenameBase, sanitizeFilenameBase } from "@/features/library/filename";
import { getAudioFormatInfo } from "@/features/audio/audioFormat";
import { getSampleTrack, type SampleTrackMetadata } from "@/features/editor/sampleMetadata";
import {
  getAdvancedMetadataValidationErrors,
  validateBpm,
  validateDiscNumber,
} from "@/features/editor/audioTaggerUtils";
import { getTrackFailureDisplay } from "@/features/workspace/systemFailure";
import {
  useMetadataEditorMode,
  type MetadataEditorMode,
} from "@/features/editor/useMetadataEditorMode";
import { useLinkedAlbumArtistDisplay } from "@/features/editor/useLinkedAlbumArtistDisplay";
import type { AlbumGroup, AudioMetadata, TagiumFile } from "@/features/library/types";
import {
  getMetadataLinkDescriptor,
  type MetadataLinkState,
} from "@/features/library/metadataLinks";

type LoadedTrack = TagiumFile & { metadata: AudioMetadata };

interface TrackMetadataEditorProps {
  selectedFile: TagiumFile | null;
  selectedFileId: string | null;
  register: UseFormRegister<AudioMetadata>;
  control: Control<AudioMetadata>;
  getValues: UseFormGetValues<AudioMetadata>;
  setError: UseFormSetError<AudioMetadata>;
  clearErrors: UseFormClearErrors<AudioMetadata>;
  setFocus: UseFormSetFocus<AudioMetadata>;
  onTrackCoverUpload: (
    picture: NonNullable<AudioMetadata["picture"]>,
    resetKey?: string | null,
  ) => void;
  onTrackCoverProcessingChange: (processing: boolean) => void;
  isTrackCoverProcessing: boolean;
  onDownloadUpdatedFile: SubmitHandler<AudioMetadata>;
  selectedFileAlbum: AlbumGroup | undefined;
  syncFilenames: boolean;
  advancedMetadata: boolean;
  metadataLinks: MetadataLinkState;
  onPreviewMetadataChange: (
    field: "filename" | "title" | "artist",
    event: ChangeEvent<HTMLInputElement>,
  ) => void;
}

interface LoadedTrackMetadataEditorProps extends Omit<TrackMetadataEditorProps, "selectedFile"> {
  selectedFile: LoadedTrack;
  focusedTitleFileIdRef: RefObject<string | null>;
  editorMode: MetadataEditorMode;
  onEditorModeChange: (mode: MetadataEditorMode) => void;
}

interface PendingTrackMetadataEditorProps extends Pick<
  TrackMetadataEditorProps,
  "selectedFile" | "advancedMetadata"
> {
  editorMode: MetadataEditorMode;
  onEditorModeChange: (mode: MetadataEditorMode) => void;
}

const hasMetadata = (selectedFile: TagiumFile | null): selectedFile is LoadedTrack =>
  Boolean(selectedFile?.metadata);

const fieldLabelClassName = "mb-1 block text-xs font-medium md:text-sm";
const placeholderClassName = "placeholder:text-muted-foreground/45";
const syncedInputClassName =
  "disabled:pointer-events-auto disabled:cursor-not-allowed disabled:border-dashed disabled:bg-muted/10 disabled:text-muted-foreground disabled:opacity-100 dark:disabled:bg-muted/10";

export const METADATA_EDITOR_FORM_LAYOUT = {
  className:
    "flex min-h-[19rem] flex-col gap-2 max-lg:[@media(max-height:700px)]:min-h-[18rem] max-lg:[@media(max-height:700px)]:gap-1.5 lg:gap-3",
  minimumHeightPx: { desktop: 304, compact: 288 },
} as const;

function DisabledReason({
  disabled,
  reason,
  children,
}: {
  disabled: boolean;
  reason: string;
  children: ReactNode;
}) {
  if (!disabled) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

interface TrackFailure {
  title: string;
  description: string;
}

function TrackFilenameHeader({
  syncFilenames,
  watchedFilename,
  sanitizedFilename,
  filenamePlaceholder,
  filenameInvalid,
  filenameRegistration,
  extension,
  failure,
  hasModeToggle = false,
}: {
  syncFilenames: boolean;
  watchedFilename: string;
  sanitizedFilename: string;
  filenamePlaceholder: string;
  filenameInvalid: boolean;
  filenameRegistration: UseFormRegisterReturn<"filename">;
  extension: string;
  failure: TrackFailure | null;
  hasModeToggle?: boolean;
}) {
  return (
    <div
      className={`relative h-16 shrink-0 border-b px-4 max-lg:[@media(max-height:700px)]:h-14 max-lg:[@media(max-height:700px)]:px-3 lg:h-[104px] lg:px-6 ${
        hasModeToggle ? "pr-40 max-lg:[@media(max-height:700px)]:pr-36 lg:pr-44" : ""
      }`}
    >
      <div className="flex h-full min-w-0 items-center">
        {syncFilenames ? (
          <h2 className="inline-flex min-w-0 max-w-full items-center text-base font-semibold text-muted-foreground max-lg:[@media(max-height:700px)]:text-sm lg:text-lg">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="min-w-0 cursor-not-allowed truncate">
                  {sanitizedFilename || filenamePlaceholder}
                </span>
              </TooltipTrigger>
              <TooltipContent>filename follows the title</TooltipContent>
            </Tooltip>
            <span className="shrink-0 select-none text-muted-foreground/70">{extension}</span>
          </h2>
        ) : (
          <label className="inline-flex min-w-0 max-w-full items-center text-base font-semibold max-lg:[@media(max-height:700px)]:text-sm lg:text-lg">
            <span className="grid w-fit max-w-[calc(100%-2.25rem)] overflow-hidden">
              <span className="invisible col-start-1 row-start-1 whitespace-pre" aria-hidden>
                {watchedFilename || filenamePlaceholder}
              </span>
              <input
                {...filenameRegistration}
                aria-label="filename"
                aria-invalid={filenameInvalid}
                aria-describedby={filenameInvalid ? "track-filename-error" : undefined}
                size={1}
                className="col-start-1 row-start-1 min-w-0 truncate bg-transparent outline-none placeholder:text-muted-foreground/45"
                placeholder={filenamePlaceholder}
              />
            </span>
            <span className="shrink-0 select-none text-muted-foreground/70">{extension}</span>
          </label>
        )}
      </div>
      <div className="absolute inset-x-4 bottom-1 h-4 min-w-0 overflow-hidden text-xs leading-4 text-destructive max-lg:[@media(max-height:700px)]:inset-x-3 max-lg:[@media(max-height:700px)]:bottom-0 lg:inset-x-6 lg:h-8">
        {filenameInvalid ? (
          <div className="flex min-w-0 items-center gap-2">
            <p
              id="track-filename-error"
              className="min-w-0 truncate font-medium"
              aria-live="polite"
            >
              filename is required
            </p>
            {failure && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="shrink-0 underline decoration-dotted underline-offset-2"
                    aria-label={`${failure.title}: ${failure.description}`}
                  >
                    track error
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-medium">{failure.title}</p>
                  <p>{failure.description}</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        ) : failure ? (
          <div className="min-w-0 text-xs text-destructive" aria-live="polite">
            <p className="truncate font-medium">{failure.title}</p>
            <p className="sr-only truncate lg:not-sr-only">{failure.description}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TrackDetailsFields({
  selectedFileId,
  focusedTitleFileIdRef,
  register,
  placeholder,
  inAlbum,
  syncFilenames,
  metadataLinks,
  filenameInvalid,
  onPreviewMetadataChange,
}: {
  selectedFileId: string | null;
  focusedTitleFileIdRef: RefObject<string | null>;
  register: UseFormRegister<AudioMetadata>;
  placeholder: SampleTrackMetadata;
  inAlbum: boolean;
  syncFilenames: boolean;
  metadataLinks: TrackMetadataEditorProps["metadataLinks"];
  filenameInvalid: boolean;
  onPreviewMetadataChange: TrackMetadataEditorProps["onPreviewMetadataChange"];
}) {
  const titleRegistration = register("title", {
    onChange: (event) => onPreviewMetadataChange("title", event),
  });
  const artistRegistration = register("artist", {
    onChange: (event) => onPreviewMetadataChange("artist", event),
  });
  const { ref: titleRegistrationRef, ...titleInputRegistration } = titleRegistration;
  const titleInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      titleRegistrationRef(node);
      if (!node || !selectedFileId) return;
      if (focusedTitleFileIdRef.current === selectedFileId) return;

      focusedTitleFileIdRef.current = selectedFileId;
      node.focus({ preventScroll: true });
    },
    [focusedTitleFileIdRef, selectedFileId, titleRegistrationRef],
  );
  const albumFieldReason = "album title is always controlled by the album";

  return (
    <>
      <div>
        <label htmlFor="track-title" className={fieldLabelClassName}>
          title:
        </label>
        <Input
          {...titleInputRegistration}
          id="track-title"
          ref={titleInputRef}
          aria-invalid={syncFilenames && filenameInvalid}
          aria-describedby={syncFilenames && filenameInvalid ? "track-filename-error" : undefined}
          placeholder={placeholder.title}
          className={placeholderClassName}
        />
      </div>
      <div>
        <label htmlFor="track-artist" className={fieldLabelClassName}>
          artist:
        </label>
        <DisabledReason
          disabled={inAlbum && metadataLinks.artist}
          reason={getMetadataLinkDescriptor("artist").disabledReason}
        >
          <Input
            {...artistRegistration}
            id="track-artist"
            placeholder={placeholder.artist}
            disabled={inAlbum && metadataLinks.artist}
            className={`${placeholderClassName} ${syncedInputClassName}`}
          />
        </DisabledReason>
      </div>
      <div>
        <label htmlFor="track-album" className={fieldLabelClassName}>
          album:
        </label>
        <DisabledReason disabled={inAlbum} reason={albumFieldReason}>
          <Input
            {...register("album")}
            id="track-album"
            placeholder={placeholder.album}
            disabled={inAlbum}
            className={`${placeholderClassName} ${syncedInputClassName}`}
          />
        </DisabledReason>
      </div>
      <div className="grid grid-cols-[minmax(4.5rem,0.8fr)_minmax(0,1.4fr)_minmax(4.5rem,0.8fr)] gap-2">
        <div>
          <label htmlFor="track-year" className={fieldLabelClassName}>
            year:
          </label>
          <DisabledReason
            disabled={inAlbum && metadataLinks.year}
            reason={getMetadataLinkDescriptor("year").disabledReason}
          >
            <Input
              type="number"
              {...register("year", { valueAsNumber: true })}
              id="track-year"
              placeholder={placeholder.year}
              disabled={inAlbum && metadataLinks.year}
              className={`${placeholderClassName} ${syncedInputClassName} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
            />
          </DisabledReason>
        </div>
        <div>
          <label htmlFor="track-genre" className={fieldLabelClassName}>
            genre:
          </label>
          <DisabledReason
            disabled={inAlbum && metadataLinks.genre}
            reason={getMetadataLinkDescriptor("genre").disabledReason}
          >
            <Input
              {...register("genre")}
              id="track-genre"
              placeholder={placeholder.genre}
              disabled={inAlbum && metadataLinks.genre}
              className={`${placeholderClassName} ${syncedInputClassName}`}
            />
          </DisabledReason>
        </div>
        <div>
          <label htmlFor="track-number" className={fieldLabelClassName}>
            track:
          </label>
          <DisabledReason
            disabled={inAlbum && metadataLinks.trackNumber}
            reason={getMetadataLinkDescriptor("trackNumber").disabledReason}
          >
            <Input
              type="number"
              {...register("trackNumber", { valueAsNumber: true })}
              id="track-number"
              placeholder={placeholder.trackNumber}
              disabled={inAlbum && metadataLinks.trackNumber}
              className={`${placeholderClassName} ${syncedInputClassName} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
            />
          </DisabledReason>
        </div>
      </div>
    </>
  );
}

const nullableNumberRegistration = {
  setValueAs: (value: string) => (value === "" ? null : Number(value)),
};

interface AdvancedFieldRegistrations {
  albumArtist: UseFormRegisterReturn<"albumArtist">;
  discNumber: UseFormRegisterReturn<"discNumber">;
  composer: UseFormRegisterReturn<"composer">;
  bpm: UseFormRegisterReturn<"bpm">;
  comment: UseFormRegisterReturn<"comment">;
}

export function AdvancedTrackDetailsFields({
  registrations,
  errors,
  albumArtistLinked,
  linkedArtistValue,
  onFieldsMount,
}: {
  registrations: AdvancedFieldRegistrations;
  errors: FieldErrors<AudioMetadata>;
  albumArtistLinked: boolean;
  linkedArtistValue: string;
  onFieldsMount?: (node: HTMLDivElement | null) => void;
}) {
  const albumArtistReason = getMetadataLinkDescriptor("albumArtist").disabledReason;
  const albumArtistReasonId = "track-album-artist-sync-reason";

  return (
    <>
      <div>
        <label htmlFor="track-album-artist" className={fieldLabelClassName}>
          album artist:
        </label>
        <DisabledReason disabled={albumArtistLinked} reason={albumArtistReason}>
          <Input
            key={albumArtistLinked ? "linked" : "unlinked"}
            {...(albumArtistLinked
              ? { name: registrations.albumArtist.name }
              : registrations.albumArtist)}
            id="track-album-artist"
            aria-describedby={albumArtistLinked ? albumArtistReasonId : undefined}
            disabled={albumArtistLinked}
            readOnly={albumArtistLinked}
            value={albumArtistLinked ? linkedArtistValue : undefined}
            placeholder="Album artist"
            className={`${placeholderClassName} ${syncedInputClassName}`}
          />
        </DisabledReason>
        {albumArtistLinked && (
          <p id={albumArtistReasonId} className="sr-only">
            {albumArtistReason}
          </p>
        )}
      </div>
      <div ref={onFieldsMount} className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="track-disc-number" className={fieldLabelClassName}>
            disc:
          </label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            {...registrations.discNumber}
            id="track-disc-number"
            aria-invalid={Boolean(errors.discNumber)}
            aria-describedby={errors.discNumber ? "track-disc-number-error" : undefined}
            placeholder="1"
            className={`${placeholderClassName} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
          />
          {errors.discNumber && (
            <p id="track-disc-number-error" className="mt-1 text-xs text-destructive">
              {errors.discNumber.message}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="track-bpm" className={fieldLabelClassName}>
            BPM:
          </label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step="any"
            {...registrations.bpm}
            id="track-bpm"
            aria-invalid={Boolean(errors.bpm)}
            aria-describedby={errors.bpm ? "track-bpm-error" : undefined}
            placeholder="120"
            className={`${placeholderClassName} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
          />
          {errors.bpm && (
            <p id="track-bpm-error" className="mt-1 text-xs text-destructive">
              {errors.bpm.message}
            </p>
          )}
        </div>
      </div>
      <div>
        <label htmlFor="track-composer" className={fieldLabelClassName}>
          composer:
        </label>
        <Input
          {...registrations.composer}
          id="track-composer"
          placeholder="Composer"
          className={placeholderClassName}
        />
      </div>
      <div>
        <label htmlFor="track-comment" className={fieldLabelClassName}>
          comment:
        </label>
        <textarea
          {...registrations.comment}
          id="track-comment"
          rows={2}
          placeholder="Add a comment"
          className="border-input placeholder:text-muted-foreground/45 selection:bg-primary selection:text-primary-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex min-h-16 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-base shadow-xs outline-none focus-visible:ring-[3px] md:text-sm"
        />
      </div>
    </>
  );
}

function TrackFileSummary({ selectedFile }: { selectedFile: LoadedTrack }) {
  return (
    <div className="grid grid-cols-2 gap-2 text-xs md:text-sm">
      <div>
        <span className="font-medium">duration: </span>
        {`${Math.floor(selectedFile.metadata.duration / 60)}:${String(Math.round(selectedFile.metadata.duration % 60)).padStart(2, "0")}`}
      </div>
      <div className="justify-self-end text-right">
        <span className="font-medium">size: </span>
        {selectedFile.file &&
          selectedFile.status !== "error" &&
          `${(selectedFile.file.size / (1024 * 1024)).toFixed(2)} MB`}
        {selectedFile.file &&
          selectedFile.status === "error" &&
          `${(selectedFile.file.size / (1024 * 1024)).toFixed(2)} MB (metadata failed)`}
        {!selectedFile.file && selectedFile.downloadStatus === "downloading" && "downloading"}
        {!selectedFile.file && selectedFile.downloadStatus === "error" && "download failed"}
        {!selectedFile.file && selectedFile.downloadStatus === "canceled" && "download canceled"}
      </div>
    </div>
  );
}

function DownloadTrackButton({
  onClick,
  disabled,
  disabledReason,
}: {
  onClick: () => void;
  disabled: boolean;
  disabledReason: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-end gap-2 pt-1 max-lg:[@media(max-height:700px)]:flex-none max-lg:[@media(max-height:700px)]:pt-0 lg:flex-none lg:pt-2">
      <DisabledReason disabled={disabled} reason={disabledReason}>
        <Button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="min-w-36 max-lg:[@media(max-height:700px)]:h-10 max-lg:[@media(max-height:700px)]:text-xs"
        >
          download track
        </Button>
      </DisabledReason>
    </div>
  );
}

export function MetadataEditorModeToggle({
  mode,
  onChange,
}: {
  mode: MetadataEditorMode;
  onChange: (mode: MetadataEditorMode) => void;
}) {
  return (
    <div
      className="inline-grid h-7 w-[8.5rem] shrink-0 grid-cols-2 rounded-md bg-muted p-0.5"
      role="group"
      aria-label="metadata fields"
    >
      {(["normal", "advanced"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={mode === option}
          onClick={() => onChange(option)}
          className={`h-6 min-w-0 cursor-pointer rounded-sm px-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-muted ${
            mode === option
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function PendingTrackMetadataEditor({
  selectedFile,
  advancedMetadata,
  editorMode,
  onEditorModeChange,
}: PendingTrackMetadataEditorProps) {
  if (!selectedFile) return null;

  const trackState =
    selectedFile.downloadStatus === "error"
      ? "download failed"
      : selectedFile.downloadStatus === "canceled"
        ? "download canceled"
        : selectedFile.status === "error"
          ? "metadata failed"
          : "loading metadata";

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-4 max-lg:[@media(max-height:700px)]:h-14 max-lg:[@media(max-height:700px)]:px-3 lg:h-[104px] lg:px-6">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-muted-foreground max-lg:[@media(max-height:700px)]:text-sm lg:text-lg">
            {selectedFile.filename}
          </h2>
          <p role="status" className="text-xs text-muted-foreground">
            {trackState}
          </p>
        </div>
        {advancedMetadata && (
          <MetadataEditorModeToggle mode={editorMode} onChange={onEditorModeChange} />
        )}
      </div>
      <div
        aria-hidden="true"
        className="flex flex-1 items-center justify-center bg-muted/5 p-4 text-center text-sm text-muted-foreground"
      >
        {trackState}
      </div>
    </div>
  );
}

const useAdvancedMetadataFormBoundary = ({
  register,
  control,
  enabled,
}: {
  register: UseFormRegister<AudioMetadata>;
  control: Control<AudioMetadata>;
  enabled: boolean;
}) => {
  const registrations: AdvancedFieldRegistrations = {
    albumArtist: register("albumArtist"),
    discNumber: register("discNumber", {
      ...nullableNumberRegistration,
      validate: (value) => !enabled || validateDiscNumber(value),
    }),
    composer: register("composer"),
    bpm: register("bpm", {
      ...nullableNumberRegistration,
      validate: (value) => !enabled || validateBpm(value),
    }),
    comment: register("comment"),
  };
  const { errors } = useFormState({ control, name: ["discNumber", "bpm"] });

  return { registrations, errors };
};

function LoadedTrackMetadataEditor({
  selectedFile,
  selectedFileId,
  focusedTitleFileIdRef,
  register,
  control,
  getValues,
  setError,
  clearErrors,
  setFocus,
  onTrackCoverUpload,
  onTrackCoverProcessingChange,
  isTrackCoverProcessing,
  onDownloadUpdatedFile,
  selectedFileAlbum,
  syncFilenames,
  advancedMetadata,
  metadataLinks,
  onPreviewMetadataChange,
  editorMode,
  onEditorModeChange,
}: LoadedTrackMetadataEditorProps) {
  const watchedTitle = useWatch({ control, name: "title", defaultValue: "" });
  const watchedFilename = useWatch({ control, name: "filename", defaultValue: "" });
  const linkedAlbumArtistDisplay = useLinkedAlbumArtistDisplay(control);
  const advancedFields = useAdvancedMetadataFormBoundary({
    register,
    control,
    enabled: advancedMetadata,
  });
  const pendingAdvancedFocusRef = useRef<"discNumber" | "bpm" | null>(null);
  const focusPendingAdvancedField = useCallback(
    (node: HTMLDivElement | null) => {
      const pendingAdvancedFocus = pendingAdvancedFocusRef.current;
      if (!node || editorMode !== "advanced" || !pendingAdvancedFocus) return;
      setFocus(pendingAdvancedFocus, { shouldSelect: true });
      pendingAdvancedFocusRef.current = null;
    },
    [editorMode, setFocus],
  );
  const filenameValue = syncFilenames ? watchedTitle : watchedFilename;
  const filenameInvalid = !isValidFilenameBase(filenameValue);
  const canDownloadTrack =
    Boolean(selectedFile.file) && !isTrackCoverProcessing && !filenameInvalid;
  const placeholder = getSampleTrack(selectedFile.id);
  const downloadErrorDisplay = selectedFile.downloadError
    ? getTrackFailureDisplay(selectedFile.downloadError)
    : null;
  const failure =
    (selectedFile.downloadStatus === "error" || selectedFile.status === "error") &&
    downloadErrorDisplay
      ? downloadErrorDisplay
      : null;
  const filenameRegistration = register("filename", {
    onChange: (event) => onPreviewMetadataChange("filename", event),
  });
  const downloadDisabledReason = isTrackCoverProcessing
    ? "cover art is still processing"
    : filenameInvalid
      ? "filename is required"
      : "track file is not ready";
  const submitDownload = () => {
    if (advancedMetadata) {
      const validationErrors = getAdvancedMetadataValidationErrors(getValues());
      clearErrors(["discNumber", "bpm"]);
      if (validationErrors.discNumber || validationErrors.bpm) {
        if (validationErrors.discNumber) {
          setError("discNumber", { type: "validate", message: validationErrors.discNumber });
        }
        if (validationErrors.bpm) {
          setError("bpm", { type: "validate", message: validationErrors.bpm });
        }
        const invalidField = validationErrors.discNumber ? "discNumber" : "bpm";
        if (editorMode === "advanced") {
          pendingAdvancedFocusRef.current = null;
          setFocus(invalidField, { shouldSelect: true });
        } else {
          pendingAdvancedFocusRef.current = invalidField;
          onEditorModeChange("advanced");
        }
        return;
      }
    }

    void onDownloadUpdatedFile(getValues());
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="flex min-h-0 flex-col h-full"
      >
        <div className="relative">
          <TrackFilenameHeader
            syncFilenames={syncFilenames}
            watchedFilename={watchedFilename}
            sanitizedFilename={sanitizeFilenameBase(filenameValue)}
            filenamePlaceholder={placeholder.filename}
            filenameInvalid={filenameInvalid}
            filenameRegistration={filenameRegistration}
            extension={getAudioFormatInfo(selectedFile.format).extension}
            failure={failure}
            hasModeToggle={advancedMetadata}
          />
          {advancedMetadata && (
            <div className="absolute right-4 top-1/2 -translate-y-1/2 max-lg:[@media(max-height:700px)]:right-3 lg:right-6">
              <MetadataEditorModeToggle mode={editorMode} onChange={onEditorModeChange} />
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-3 pb-3 max-lg:[@media(max-height:700px)]:p-2 lg:p-6 lg:pb-28">
          <div className="flex min-h-full flex-col gap-3 max-lg:[@media(max-height:700px)]:gap-2 lg:min-h-0 lg:flex-row lg:gap-4">
            <Controller
              name="picture"
              control={control}
              render={({ field }) => (
                <CoverArt
                  resetKey={selectedFileId}
                  picture={field.value}
                  onCoverUpload={onTrackCoverUpload}
                  onProcessingChange={onTrackCoverProcessingChange}
                  disabled={Boolean(selectedFileAlbum) && metadataLinks.artwork}
                  disabledReason={getMetadataLinkDescriptor("artwork").disabledReason}
                />
              )}
            />
            <div className="flex flex-1 flex-col gap-2 max-lg:[@media(max-height:700px)]:gap-1.5 lg:gap-3">
              <div
                data-editor-form-area
                className={METADATA_EDITOR_FORM_LAYOUT.className}
              >
                {advancedMetadata && editorMode === "advanced" ? (
                  <AdvancedTrackDetailsFields
                    registrations={advancedFields.registrations}
                    errors={advancedFields.errors}
                    albumArtistLinked={metadataLinks.albumArtist}
                    linkedArtistValue={linkedAlbumArtistDisplay}
                    onFieldsMount={focusPendingAdvancedField}
                  />
                ) : (
                  <TrackDetailsFields
                    selectedFileId={selectedFileId}
                    focusedTitleFileIdRef={focusedTitleFileIdRef}
                    register={register}
                    placeholder={placeholder}
                    inAlbum={Boolean(selectedFileAlbum)}
                    syncFilenames={syncFilenames}
                    metadataLinks={metadataLinks}
                    filenameInvalid={filenameInvalid}
                    onPreviewMetadataChange={onPreviewMetadataChange}
                  />
                )}
              </div>
              <TrackFileSummary selectedFile={selectedFile} />
              <DownloadTrackButton
                onClick={submitDownload}
                disabled={!canDownloadTrack}
                disabledReason={downloadDisabledReason}
              />
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

export default function TrackMetadataEditor(props: TrackMetadataEditorProps) {
  const focusedTitleFileIdRef = useRef<string | null>(null);
  const { mode: editorMode, setMode: setEditorMode } = useMetadataEditorMode(
    props.advancedMetadata,
  );
  const currentSelection = props.selectedFile
    ? { selectedFile: props.selectedFile, selectedFileAlbum: props.selectedFileAlbum }
    : null;
  const [retainedSelection, setRetainedSelection] = useState(currentSelection);
  if (
    currentSelection &&
    (retainedSelection?.selectedFile !== currentSelection.selectedFile ||
      retainedSelection.selectedFileAlbum !== currentSelection.selectedFileAlbum)
  ) {
    setRetainedSelection(currentSelection);
  }
  const displayedSelection = currentSelection ?? retainedSelection;
  const trackIsSelected = currentSelection !== null;
  useEffect(() => {
    if (trackIsSelected || !retainedSelection) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timeoutId = globalThis.setTimeout(
      () => setRetainedSelection(null),
      reduceMotion ? 0 : 250,
    );
    return () => globalThis.clearTimeout(timeoutId);
  }, [retainedSelection, trackIsSelected]);

  const releaseExitedSelection = (event: TransitionEvent<HTMLDivElement>) => {
    if (
      !trackIsSelected &&
      event.target === event.currentTarget &&
      event.propertyName === "opacity"
    ) {
      setRetainedSelection(null);
    }
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        data-editor-state="empty-selection"
        aria-hidden={trackIsSelected}
        inert={trackIsSelected}
        className={`absolute inset-0 flex items-center justify-center bg-muted/5 transition-opacity duration-200 motion-reduce:transition-none ${
          trackIsSelected ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
      >
        <div className="text-center">
          <p className="text-muted-foreground">select a track to edit its tags</p>
        </div>
      </div>
      <div
        data-editor-state="loaded-track"
        aria-hidden={!trackIsSelected}
        inert={!trackIsSelected}
        onTransitionEnd={releaseExitedSelection}
        className={`absolute inset-0 flex min-h-0 flex-col transition-opacity duration-200 motion-reduce:transition-none ${
          trackIsSelected ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {displayedSelection &&
          (hasMetadata(displayedSelection.selectedFile) ? (
            <LoadedTrackMetadataEditor
              {...props}
              selectedFile={displayedSelection.selectedFile}
              selectedFileId={displayedSelection.selectedFile.id}
              selectedFileAlbum={displayedSelection.selectedFileAlbum}
              focusedTitleFileIdRef={focusedTitleFileIdRef}
              editorMode={editorMode}
              onEditorModeChange={setEditorMode}
            />
          ) : (
            <PendingTrackMetadataEditor
              selectedFile={displayedSelection.selectedFile}
              advancedMetadata={props.advancedMetadata}
              editorMode={editorMode}
              onEditorModeChange={setEditorMode}
            />
          ))}
      </div>
    </div>
  );
}
