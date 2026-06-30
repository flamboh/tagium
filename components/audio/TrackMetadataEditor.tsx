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
  const watchedTitle = useWatch({ control, name: "title" });
  const inAlbum = !!selectedFileAlbum;
  const audioReady = Boolean(selectedFile?.file);

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
                <div
                  className={`flex items-center h-9 w-full rounded-md border border-input bg-transparent dark:bg-input/30 px-3 py-1 text-base shadow-sm transition-colors md:text-sm ${syncFilenames ? "opacity-50 cursor-not-allowed pointer-events-none" : "focus-within:ring-1 focus-within:ring-ring"}`}
                >
                  {syncFilenames ? (
                    <span className="flex-1 min-w-0 truncate text-muted-foreground">
                      {filenamify(watchedTitle || "", { replacement: "-" })}
                    </span>
                  ) : (
                    <input
                      {...register("filename")}
                      className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground min-w-0"
                      placeholder="bangarang"
                    />
                  )}
                  <span className="text-muted-foreground select-none">.mp3</span>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium md:text-sm">title:</label>
                <Input {...register("title")} placeholder="Bangarang" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium md:text-sm">artist:</label>
                <Input {...register("artist")} placeholder="Skrillex" disabled={inAlbum} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium md:text-sm">album:</label>
                <Input {...register("album")} placeholder="Bangarang EP" disabled={inAlbum} />
              </div>
              <div className="grid grid-cols-[minmax(4.5rem,0.8fr)_minmax(0,1.4fr)_minmax(4.5rem,0.8fr)] gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium md:text-sm">year:</label>
                  <Input
                    type="number"
                    {...register("year", { valueAsNumber: true })}
                    placeholder="2011"
                    disabled={inAlbum}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium md:text-sm">genre:</label>
                  <Input {...register("genre")} placeholder="Dubstep" disabled={inAlbum} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium md:text-sm">track:</label>
                  <Input
                    type="number"
                    {...register("trackNumber", { valueAsNumber: true })}
                    placeholder="2"
                    disabled={inAlbum && syncTrackNumbers}
                    className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
              <div className="flex min-h-0 flex-1 items-center justify-center gap-2 pt-1 max-lg:[@media(max-height:700px)]:flex-none max-lg:[@media(max-height:700px)]:pt-0 lg:flex-none lg:justify-end lg:pt-2">
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
