"use client";

import { useCallback, useRef } from "react";
import type { ChangeEvent, ReactNode } from "react";
import {
  Control,
  Controller,
  SubmitHandler,
  UseFormHandleSubmit,
  UseFormRegister,
  useWatch,
} from "react-hook-form";
import filenamify from "filenamify";
import CoverArt from "./coverArt";
import { AlbumGroup, AudioMetadata, TagiumFile } from "./types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { getDownloadErrorDisplay } from "./downloadErrorMessage";
import { getSampleTrack } from "./sampleMetadata";

interface TrackMetadataEditorProps {
  selectedFile: TagiumFile | null;
  selectedFileId: string | null;
  register: UseFormRegister<AudioMetadata>;
  control: Control<AudioMetadata>;
  handleSubmit: UseFormHandleSubmit<AudioMetadata>;
  onTrackCoverUpload: (file: File) => void;
  onDownloadUpdatedFile: SubmitHandler<AudioMetadata>;
  selectedFileAlbum: AlbumGroup | undefined;
  syncFilenames: boolean;
  syncTrackNumbers: boolean;
  onPreviewMetadataChange: (
    field: "filename" | "title",
    event: ChangeEvent<HTMLInputElement>,
  ) => void;
}

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

export default function TrackMetadataEditor({
  selectedFile,
  selectedFileId,
  register,
  control,
  handleSubmit,
  onTrackCoverUpload,
  onDownloadUpdatedFile,
  selectedFileAlbum,
  syncFilenames,
  syncTrackNumbers,
  onPreviewMetadataChange,
}: TrackMetadataEditorProps) {
  const watchedTitle = useWatch({ control, name: "title", defaultValue: "" });
  const watchedFilename = useWatch({ control, name: "filename", defaultValue: "" });
  const inAlbum = !!selectedFileAlbum;
  const audioReady = Boolean(selectedFile?.file);
  const albumFieldReason = "controlled by the album";
  const filenameRegistration = register("filename", {
    onChange: (event) => onPreviewMetadataChange("filename", event),
  });
  const titleRegistration = register("title", {
    onChange: (event) => onPreviewMetadataChange("title", event),
  });
  const { ref: titleRegistrationRef, ...titleInputRegistration } = titleRegistration;
  const placeholderClassName = "placeholder:text-muted-foreground/45";
  const syncedInputClassName =
    "disabled:pointer-events-auto disabled:cursor-not-allowed disabled:border-dashed disabled:bg-muted/10 disabled:text-muted-foreground disabled:opacity-100 dark:disabled:bg-muted/10";
  const focusedTitleFileIdRef = useRef<string | null>(null);
  const titleInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      titleRegistrationRef(node);
      if (!node || !selectedFileId) return;
      if (focusedTitleFileIdRef.current === selectedFileId) return;

      focusedTitleFileIdRef.current = selectedFileId;
      node.focus({ preventScroll: true });
    },
    [selectedFileId, titleRegistrationRef],
  );

  if (!selectedFile || !selectedFile.metadata) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/5">
        <div className="text-center">
          <p className="text-muted-foreground">select a track to edit its tags</p>
        </div>
      </div>
    );
  }

  const placeholder = getSampleTrack(selectedFile.id);
  const filenamePlaceholder = placeholder.filename;
  const downloadErrorDisplay = selectedFile.downloadError
    ? getDownloadErrorDisplay(selectedFile.downloadError)
    : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="flex min-h-0 flex-col h-full"
      >
        <div className="h-16 border-b flex-shrink-0 flex flex-col justify-center gap-1 px-4 max-lg:[@media(max-height:700px)]:h-12 max-lg:[@media(max-height:700px)]:px-3 lg:h-[104px] lg:p-6">
          {syncFilenames ? (
            <h2 className="inline-flex min-w-0 max-w-full items-center text-base font-semibold text-muted-foreground max-lg:[@media(max-height:700px)]:text-sm lg:text-lg">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="min-w-0 cursor-not-allowed truncate">
                    {filenamify(watchedTitle, { replacement: "-" })}
                  </span>
                </TooltipTrigger>
                <TooltipContent>filename follows the title</TooltipContent>
              </Tooltip>
              <span className="shrink-0 select-none text-muted-foreground/70">.mp3</span>
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
                  size={1}
                  className="col-start-1 row-start-1 min-w-0 truncate bg-transparent outline-none placeholder:text-muted-foreground/45"
                  placeholder={filenamePlaceholder}
                />
              </span>
              <span className="shrink-0 select-none text-muted-foreground/70">.mp3</span>
            </label>
          )}
          {(selectedFile.downloadStatus === "error" || selectedFile.status === "error") &&
            downloadErrorDisplay && (
              <div className="min-w-0 text-xs text-destructive" aria-live="polite">
                <p className="font-medium leading-tight">{downloadErrorDisplay.title}</p>
                <p className="truncate leading-tight">{downloadErrorDisplay.description}</p>
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
                />
              )}
            />
            <div className="flex flex-1 flex-col gap-2 max-lg:[@media(max-height:700px)]:gap-1.5 lg:gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium md:text-sm">title:</label>
                <Input
                  {...titleInputRegistration}
                  ref={titleInputRef}
                  placeholder={placeholder.title}
                  className={placeholderClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium md:text-sm">artist:</label>
                <DisabledReason disabled={inAlbum} reason={albumFieldReason}>
                  <Input
                    {...register("artist")}
                    placeholder={placeholder.artist}
                    disabled={inAlbum}
                    className={`${placeholderClassName} ${syncedInputClassName}`}
                  />
                </DisabledReason>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium md:text-sm">album:</label>
                <DisabledReason disabled={inAlbum} reason={albumFieldReason}>
                  <Input
                    {...register("album")}
                    placeholder={placeholder.album}
                    disabled={inAlbum}
                    className={`${placeholderClassName} ${syncedInputClassName}`}
                  />
                </DisabledReason>
              </div>
              <div className="grid grid-cols-[minmax(4.5rem,0.8fr)_minmax(0,1.4fr)_minmax(4.5rem,0.8fr)] gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium md:text-sm">year:</label>
                  <DisabledReason disabled={inAlbum} reason={albumFieldReason}>
                    <Input
                      type="number"
                      {...register("year", { valueAsNumber: true })}
                      placeholder={placeholder.year}
                      disabled={inAlbum}
                      className={`${placeholderClassName} ${syncedInputClassName} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                    />
                  </DisabledReason>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium md:text-sm">genre:</label>
                  <DisabledReason disabled={inAlbum} reason={albumFieldReason}>
                    <Input
                      {...register("genre")}
                      placeholder={placeholder.genre}
                      disabled={inAlbum}
                      className={`${placeholderClassName} ${syncedInputClassName}`}
                    />
                  </DisabledReason>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium md:text-sm">track:</label>
                  <DisabledReason
                    disabled={inAlbum && syncTrackNumbers}
                    reason="follows album order"
                  >
                    <Input
                      type="number"
                      {...register("trackNumber", { valueAsNumber: true })}
                      placeholder={placeholder.trackNumber}
                      disabled={inAlbum && syncTrackNumbers}
                      className={`${placeholderClassName} ${syncedInputClassName} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                    />
                  </DisabledReason>
                </div>
              </div>
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
                  {!selectedFile.file &&
                    selectedFile.downloadStatus === "downloading" &&
                    "downloading"}
                  {!selectedFile.file &&
                    selectedFile.downloadStatus === "error" &&
                    "download failed"}
                  {!selectedFile.file &&
                    selectedFile.downloadStatus === "canceled" &&
                    "download canceled"}
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-end gap-2 pt-1 max-lg:[@media(max-height:700px)]:flex-none max-lg:[@media(max-height:700px)]:pt-0 lg:flex-none lg:pt-2">
                <DisabledReason disabled={!audioReady} reason="track file is not ready">
                  <Button
                    type="button"
                    onClick={handleSubmit(onDownloadUpdatedFile)}
                    disabled={!audioReady}
                    className="min-w-36 max-lg:[@media(max-height:700px)]:h-10 max-lg:[@media(max-height:700px)]:text-xs"
                  >
                    download track
                  </Button>
                </DisabledReason>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
