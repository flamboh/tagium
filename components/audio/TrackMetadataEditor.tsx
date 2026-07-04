"use client";

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
}: TrackMetadataEditorProps) {
  const watchedTitle = useWatch({ control, name: "title", defaultValue: "" });
  const watchedFilename = useWatch({ control, name: "filename", defaultValue: "" });
  const inAlbum = !!selectedFileAlbum;
  const audioReady = Boolean(selectedFile?.file);
  const filenameInputSize = Math.max(watchedFilename.length, "bangarang".length);
  const placeholderClassName = "placeholder:text-muted-foreground/45";
  const syncedInputClassName =
    "disabled:pointer-events-auto disabled:cursor-not-allowed disabled:border-dashed disabled:bg-muted/10 disabled:text-muted-foreground disabled:opacity-100 dark:disabled:bg-muted/10";

  if (!selectedFile || !selectedFile.metadata) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/5">
        <div className="text-center">
          <p className="text-muted-foreground">select a track to edit its tags</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="flex min-h-0 flex-col h-full"
      >
        <div className="h-16 border-b flex-shrink-0 flex flex-col justify-center gap-1 px-4 max-lg:[@media(max-height:700px)]:h-12 max-lg:[@media(max-height:700px)]:px-3 lg:h-[104px] lg:p-6">
          <h2 className="truncate text-base font-semibold max-lg:[@media(max-height:700px)]:text-sm lg:text-lg">
            {selectedFile.filename}
          </h2>
          {(selectedFile.downloadStatus === "error" || selectedFile.status === "error") &&
            selectedFile.downloadError && (
              <p className="text-xs text-destructive truncate" aria-live="polite">
                error: {selectedFile.downloadError}
              </p>
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
                <label className="mb-1 block text-xs font-medium md:text-sm">filename:</label>
                <label
                  className={`flex h-9 w-full items-center rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors dark:bg-input/30 md:text-sm ${syncFilenames ? "cursor-not-allowed border-dashed bg-muted/10 text-muted-foreground dark:bg-muted/10" : "focus-within:ring-1 focus-within:ring-ring"}`}
                >
                  {syncFilenames ? (
                    <span className="inline-flex min-w-0 max-w-full items-center">
                      <span className="min-w-0 truncate">
                        {filenamify(watchedTitle, { replacement: "-" })}
                      </span>
                      <span className="shrink-0 select-none text-muted-foreground/70">.mp3</span>
                    </span>
                  ) : (
                    <span className="inline-flex min-w-0 flex-1 items-center">
                      <input
                        {...register("filename")}
                        size={filenameInputSize}
                        className="min-w-[1ch] max-w-[calc(100%-2.25rem)] bg-transparent outline-none placeholder:text-muted-foreground/45"
                        placeholder="bangarang"
                      />
                      <span className="shrink-0 select-none text-muted-foreground/70">.mp3</span>
                    </span>
                  )}
                </label>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium md:text-sm">title:</label>
                <Input
                  {...register("title")}
                  placeholder="Bangarang"
                  className={placeholderClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium md:text-sm">artist:</label>
                <Input
                  {...register("artist")}
                  placeholder="Skrillex"
                  disabled={inAlbum}
                  className={`${placeholderClassName} ${syncedInputClassName}`}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium md:text-sm">album:</label>
                <Input
                  {...register("album")}
                  placeholder="Bangarang EP"
                  disabled={inAlbum}
                  className={`${placeholderClassName} ${syncedInputClassName}`}
                />
              </div>
              <div className="grid grid-cols-[minmax(4.5rem,0.8fr)_minmax(0,1.4fr)_minmax(4.5rem,0.8fr)] gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium md:text-sm">year:</label>
                  <Input
                    type="number"
                    {...register("year", { valueAsNumber: true })}
                    placeholder="2011"
                    disabled={inAlbum}
                    className={`${placeholderClassName} ${syncedInputClassName} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium md:text-sm">genre:</label>
                  <Input
                    {...register("genre")}
                    placeholder="Dubstep"
                    disabled={inAlbum}
                    className={`${placeholderClassName} ${syncedInputClassName}`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium md:text-sm">track:</label>
                  <Input
                    type="number"
                    {...register("trackNumber", { valueAsNumber: true })}
                    placeholder="2"
                    disabled={inAlbum && syncTrackNumbers}
                    className={`${placeholderClassName} ${syncedInputClassName} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                  />
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
                <Button
                  type="button"
                  onClick={handleSubmit(onDownloadUpdatedFile)}
                  disabled={!audioReady}
                  className="min-w-36 max-lg:[@media(max-height:700px)]:h-10 max-lg:[@media(max-height:700px)]:text-xs"
                >
                  download track
                </Button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
