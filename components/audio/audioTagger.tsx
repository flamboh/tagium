"use client";

import { z } from "zod";
// import { IPicture } from "music-metadata";
import { useState, useEffect, useCallback } from "react";
// import { parseBuffer } from "music-metadata"; // Removed client-side import
// import { parseAudioFile } from "@/app/actions";
import AudioUpload from "./audioUpload";
import CoverArt from "./coverArt";
import FileList, { FileStatus } from "./FileList";
import { Button } from "../ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "../ui/label";
import { SubmitHandler, useForm, Controller } from "react-hook-form";
import { Input } from "../ui/input";

const audioMetadataSchema = z.object({
  filename: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  year: z.number().nullish(),
  genre: z.string().or(z.array(z.string())),
  duration: z.number(),
  bitrate: z.number(),
  sampleRate: z.number(),
  picture: z.array(z.any()), // z.custom<IPicture>() removed to avoid import
  trackNumber: z.number().nullish(),
});

export type AudioMetadata = z.infer<typeof audioMetadataSchema>;

interface TagiumFile extends FileStatus {
  metadata?: AudioMetadata;
  originalFile: File;
  buffer?: ArrayBuffer;
}

export default function AudioTagger() {
  const [files, setFiles] = useState<TagiumFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  
  const { register, handleSubmit, control, setValue, reset, watch } =
    useForm<AudioMetadata>();

  const selectedFile = files.find((f) => f.id === selectedFileId);

  // Update form when selected file changes
  useEffect(() => {
    if (selectedFile?.metadata) {
      reset(selectedFile.metadata);
    } else {
      // Optional: reset to empty or keep previous? Better to reset.
      // reset({}); 
    }
  }, [selectedFileId, selectedFile, reset]);

  const onSubmit: SubmitHandler<AudioMetadata> = async (data) => {
    if (!selectedFile) return;

    try {
      await handleTagUpdate(selectedFile, data);
      console.log("Tags updated successfully");
    } catch (error) {
      console.error("Failed to update tags:", error);
    }
  };

  const handleAudioUpload = async (uploadedFiles: File[]) => {
    setLoading(true);
    const newFiles: TagiumFile[] = [];

    const MP3Tag = (await import("mp3tag.js")).default;

    for (const file of uploadedFiles) {
      const id = crypto.randomUUID();
      try {
        const arrayBuffer = await file.arrayBuffer();
        const mp3tag = new MP3Tag(arrayBuffer, false); // false for read-only/not saving immediately
        mp3tag.read();

        if (mp3tag.error) {
            throw new Error(mp3tag.error);
        }

        // Get duration using Audio API
        const getDuration = (): Promise<number> => {
            return new Promise((resolve) => {
                const audio = new Audio(URL.createObjectURL(file));
                audio.onloadedmetadata = () => {
                    URL.revokeObjectURL(audio.src);
                    resolve(audio.duration);
                };
                audio.onerror = () => {
                     URL.revokeObjectURL(audio.src);
                     resolve(0);
                }
            });
        };

        const duration = await getDuration();

        // Map mp3tag tags to our schema
        // Note: mp3tag.js tags object structure depends on the version but usually has title, artist, etc.
        // v2 tags are in mp3tag.tags.v2
        
        const tags = mp3tag.tags;
        
        let pictureData: any[] = [];
        if (tags.v2 && tags.v2.APIC) {
             pictureData = tags.v2.APIC.map((pic: any) => ({
                 format: pic.format,
                 type: pic.type,
                 description: pic.description,
                 data: new Uint8Array(pic.data),
             }));
        }

        const metadata: AudioMetadata = {
          filename: file.name.split(".").slice(0, -1).join("."),
          title: tags.title || "",
          artist: tags.artist || "",
          album: tags.album || "",
          year: tags.year ? parseInt(tags.year) : undefined,
          genre: tags.genre || "",
          duration: duration,
          bitrate: 0, // mp3tag.js might not provide bitrate easily without parsing frames, set to 0 for now or calculate if possible
          sampleRate: 0, // same for sampleRate
          picture: pictureData,
          trackNumber: tags.track ? parseInt(tags.track) : undefined,
        };

        newFiles.push({
          id,
          file,
          originalFile: file,
          filename: file.name,
          status: "pending",
          metadata,
        });
      } catch (error) {
        console.error(`Error parsing metadata for ${file.name}:`, error);
        newFiles.push({
          id,
          file,
          originalFile: file,
          filename: file.name,
          status: "error",
        });
      }
    }

    setFiles((prev) => [...prev, ...newFiles]);
    
    // Select the first new file if none selected
    if (!selectedFileId && newFiles.length > 0) {
      setSelectedFileId(newFiles[0].id);
    }
    
    setLoading(false);
  };

  const handleTagUpdate = async (fileToUpdate: TagiumFile, newTags: AudioMetadata) => {
    try {
      const MP3Tag = (await import("mp3tag.js")).default;
      
      // Use the original file or the already modified buffer if we had one?
      // For now, always read from the current file object in state
      const arrayBuffer = await fileToUpdate.file.arrayBuffer();
      
      if (!arrayBuffer) {
        throw new Error("Audio file not found");
      }
      const mp3tag = new MP3Tag(arrayBuffer, true);

      mp3tag.read();

      if (mp3tag.error) {
        throw new Error(mp3tag.error);
      }

      // Update tag properties
      mp3tag.tags.title = newTags.title || "";
      mp3tag.tags.artist = newTags.artist || "";
      mp3tag.tags.album = newTags.album || "";
      if (newTags.year !== null && newTags.year !== undefined) {
        mp3tag.tags.year = newTags.year.toString();
      }
      if (Array.isArray(newTags.genre)) {
        mp3tag.tags.genre = newTags.genre.join(", ");
      } else {
        mp3tag.tags.genre = newTags.genre || "";
      }
      if (newTags.trackNumber !== null && newTags.trackNumber !== undefined) {
        mp3tag.tags.track = newTags.trackNumber.toString();
      }

      // Handle picture/album art
      if (newTags.picture && newTags.picture.length > 0 && mp3tag.tags.v2) {
        mp3tag.tags.v2.APIC = newTags.picture.map((pic) => ({
          format: (pic.format as string) || "image/jpeg",
          type: typeof pic.type === 'number' ? pic.type : 3, // Front cover
          description: (pic.description as string) || "",
          data: Array.from(pic.data),
        }));
      }

      mp3tag.save();

      if (mp3tag.error) {
        throw new Error(mp3tag.error);
      }

      const updatedFile = new File(
        [new Uint8Array(mp3tag.buffer)],
        newTags.filename ? `${newTags.filename}.mp3` : fileToUpdate.filename,
        {
          type: fileToUpdate.file.type,
        }
      );

      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileToUpdate.id
            ? {
                ...f,
                file: updatedFile,
                filename: updatedFile.name,
                metadata: {
                  ...newTags,
                  duration: f.metadata?.duration || 0,
                  bitrate: f.metadata?.bitrate || 0,
                  sampleRate: f.metadata?.sampleRate || 0,
                  picture: f.metadata?.picture || [],
                },
                status: "saved",
              }
            : f
        )
      );
    } catch (error) {
      console.error("Error updating tags:", error);
      setFiles((prev) =>
        prev.map((f) =>
          f.id === fileToUpdate.id ? { ...f, status: "error" } : f
        )
      );
      throw error;
    }
  };

  const handleSaveAll = async () => {
    if (files.length === 0) return;
    
    setLoading(true);
    try {
      // Save files sequentially to avoid memory issues or race conditions
      for (const file of files) {
        // Only save if it has metadata (it should)
        if (file.metadata) {
           // We need to call handleTagUpdate but it updates state, which might be tricky in a loop
           // if we rely on 'files' state.
           // However, handleTagUpdate uses functional state update, so it should be fine.
           // But it's async.
           await handleTagUpdate(file, file.metadata);
        }
      }
    } catch (error) {
      console.error("Error saving all files:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCoverUpload = (file: File) => {
    // Convert File to IPicture format for form
    const reader = new FileReader();
    reader.onload = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      const uint8Array = new Uint8Array(arrayBuffer);
      setValue("picture", [
        {
          format: file.type,
          data: uint8Array,
          description: "Uploaded cover",
        },
      ]);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDownloadUpdatedFile = (file: TagiumFile) => {
    const url = URL.createObjectURL(file.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-6xl flex gap-6 h-[800px]">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 flex flex-col gap-4">
        <Card className="h-full flex flex-col overflow-hidden py-0">
           <div className="p-6 border-b">
             <AudioUpload onAudioUpload={handleAudioUpload} />
           </div>
           <FileList 
             files={files} 
             selectedFileId={selectedFileId} 
             onSelectFile={setSelectedFileId} 
           />
           <div className="p-6 border-t mt-auto">
             <Button 
               className="w-full" 
               onClick={handleSaveAll}
               disabled={files.length === 0 || loading}
             >
               {loading ? "Saving..." : "Save All"}
             </Button>
           </div>
        </Card>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {selectedFile && selectedFile.metadata ? (
          <Card className="flex-1 overflow-hidden py-0">
            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col h-full">
              <CardHeader className="p-6 space-y-2">
                <CardTitle>Edit Metadata</CardTitle>
                <CardDescription>{selectedFile.filename}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto border-t p-6">
                <div className="flex gap-4 flex-col md:flex-row">
                  <Controller
                    name="picture"
                    control={control}
                    render={({ field }) => (
                      <CoverArt
                        key={selectedFileId}
                        picture={field.value}
                        onCoverUpload={handleCoverUpload}
                      />
                    )}
                  />
                  <div className="flex-1 grid grid-cols-1 gap-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        filename:
                      </label>
                      <div className="flex items-center h-9 w-full rounded-md border border-input bg-transparent dark:bg-input/30 px-3 py-1 text-base shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm">
                        <input
                          {...register("filename")}
                          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground min-w-0"
                        />
                        <span className="text-muted-foreground select-none">.mp3</span>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        title:
                      </label>
                      <Input
                        {...register("title")}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        artist:
                      </label>
                      <Input
                        {...register("artist")}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        album:
                      </label>
                      <Input
                        {...register("album")}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        year:
                      </label>
                      <Input
                        {...register("year", { valueAsNumber: true })}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        genre:
                      </label>
                      <Input
                        {...register("genre")}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        track:
                      </label>
                      <Input
                        {...register("trackNumber", { valueAsNumber: true })}
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
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="p-6 border-t mt-auto flex justify-end gap-2">
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => handleDownloadUpdatedFile(selectedFile)}
                >
                  Download
                </Button>
                <Button type="submit">
                  Save Changes
                </Button>
              </CardFooter>
            </form>
          </Card>
        ) : (
          <div className="flex-1 flex items-center justify-center border rounded-lg bg-muted/10">
            <div className="text-center">
              <h3 className="text-lg font-medium">No file selected</h3>
              <p className="text-muted-foreground">Upload files to get started</p>
              <div className="mt-4">
                 <AudioUpload onAudioUpload={handleAudioUpload} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
