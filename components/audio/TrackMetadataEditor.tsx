"use client";

import {
  Control,
  Controller,
  SubmitHandler,
  UseFormHandleSubmit,
  UseFormRegister,
} from "react-hook-form";
import AudioUpload from "./audioUpload";
import CoverArt from "./coverArt";
import { AudioMetadata, TagiumFile } from "./types";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "../ui/input";

interface TrackMetadataEditorProps {
  selectedFile: TagiumFile | null;
  selectedFileId: string | null;
  register: UseFormRegister<AudioMetadata>;
  control: Control<AudioMetadata>;
  handleSubmit: UseFormHandleSubmit<AudioMetadata>;
  onSubmit: SubmitHandler<AudioMetadata>;
  onTrackCoverUpload: (file: File) => void;
  onDownloadUpdatedFile: (file: TagiumFile) => void;
  onAudioUpload: (files: File[]) => void;
}

export default function TrackMetadataEditor({
  selectedFile,
  selectedFileId,
  register,
  control,
  handleSubmit,
  onSubmit,
  onTrackCoverUpload,
  onDownloadUpdatedFile,
  onAudioUpload,
}: TrackMetadataEditorProps) {
  if (!selectedFile || !selectedFile.metadata) {
    return (
      <div className="flex-1 flex items-center justify-center border rounded-lg bg-muted/10">
        <div className="text-center">
          <h3 className="text-lg font-medium">No track selected</h3>
          <p className="text-muted-foreground">Upload tracks to get started</p>
          <div className="mt-4">
            <AudioUpload onAudioUpload={onAudioUpload} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className="flex-1 overflow-hidden py-0">
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col h-full">
        <CardHeader className="p-6 space-y-2 h-[104px] border-b">
          <CardTitle>track metadata</CardTitle>
          <CardDescription>{selectedFile.filename}</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-6">
          <div className="flex gap-4 flex-col lg:flex-row">
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
            <div className="flex-1 grid grid-cols-1 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">filename:</label>
                <div className="flex items-center h-9 w-full rounded-md border border-input bg-transparent dark:bg-input/30 px-3 py-1 text-base shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm">
                  <input
                    {...register("filename")}
                    className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground min-w-0"
                    placeholder="bangarang"
                  />
                  <span className="text-muted-foreground select-none">.mp3</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">title:</label>
                <Input {...register("title")} placeholder="Bangarang" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">artist:</label>
                <Input {...register("artist")} placeholder="Skrillex" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">album:</label>
                <Input {...register("album")} placeholder="Bangarang EP" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">year:</label>
                <Input
                  type="number"
                  {...register("year", { valueAsNumber: true })}
                  placeholder="2011"
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">genre:</label>
                <Input {...register("genre")} placeholder="Dubstep" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">track:</label>
                <Input
                  type="number"
                  {...register("trackNumber", { valueAsNumber: true })}
                  placeholder="2"
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm pt-2 border-t">
                <div>
                  <span className="font-medium">duration: </span>
                  {`${Math.floor(selectedFile.metadata.duration / 60)}:${(
                    selectedFile.metadata.duration % 60
                  )
                    .toFixed(0)
                    .padStart(2, "0")}`}
                </div>
                <div>
                  <span className="font-medium">size: </span>
                  {(selectedFile.file.size / (1024 * 1024)).toFixed(2)} MB
                </div>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="p-6 border-t mt-auto flex justify-end gap-2">
          <Button
            variant="outline"
            type="button"
            onClick={() => onDownloadUpdatedFile(selectedFile)}
          >
            Download
          </Button>
          <Button type="submit">Save Changes</Button>
        </CardFooter>
      </form>
    </Card>
  );
}
