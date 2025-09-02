"use client";

import { z } from "zod";
import { IPicture } from "music-metadata";
import { useState } from "react";
import { parseBlob } from "music-metadata";
import AudioUpload from "./audioUpload";
import CoverArt from "./coverArt";
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
  picture: z.array(z.custom<IPicture>()),
  trackNumber: z.number().nullish(),
});

export type AudioMetadata = z.infer<typeof audioMetadataSchema>;

export default function AudioTagger() {
  const [audio, setAudio] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [cover, setCover] = useState<File | null>(null);
  const { register, handleSubmit, control, setValue } =
    useForm<AudioMetadata>();

  const onSubmit: SubmitHandler<AudioMetadata> = async (data) => {
    console.log(data);
    try {
      await handleTagUpdate(data);
      console.log("Tags updated successfully");
    } catch (error) {
      console.error("Failed to update tags:", error);
    }
  };

  const handleAudioUpload = async (file: File) => {
    setAudio(file);
    setLoading(true);
    try {
      const audioMetadata = await parseBlob(file);
      setMetadata({
        filename: file.name.split(".").slice(0, -1).join("."),
        title: audioMetadata.common.title || "",
        artist: audioMetadata.common.artist || "",
        album: audioMetadata.common.album || "",
        year: audioMetadata.common.year || undefined,
        genre: audioMetadata.common.genre || "",
        duration: audioMetadata.format.duration || 0,
        bitrate: audioMetadata.format.bitrate || 0,
        sampleRate: audioMetadata.format.sampleRate || 0,
        picture: audioMetadata.common.picture || [],
        trackNumber: audioMetadata.common.track.no || undefined,
      });
    } catch (error) {
      console.error("Error parsing metadata:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleTagUpdate = async (newTags: AudioMetadata) => {
    try {
      const MP3Tag = (await import("mp3tag.js")).default;
      const arrayBuffer = await audio?.arrayBuffer();
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
      if (newTags.trackTotal !== null && newTags.trackTotal !== undefined) {
        mp3tag.tags.totaltracks = newTags.trackTotal.toString();
      }
      if (newTags.discNumber !== null && newTags.discNumber !== undefined) {
        mp3tag.tags.disk = newTags.discNumber.toString();
      }
      if (newTags.discTotal !== null && newTags.discTotal !== undefined) {
        mp3tag.tags.totaldisks = newTags.discTotal.toString();
      }

      mp3tag.save();

      if (mp3tag.error) {
        throw new Error(mp3tag.error);
      }

      const updatedAudio = new File(
        [new Uint8Array(mp3tag.buffer)],
        newTags.filename || audio?.name || "",
        {
          type: audio?.type,
        }
      );

      setAudio(updatedAudio);
      setMetadata((prevMetadata) => ({
        ...newTags,
        duration: prevMetadata?.duration || 0,
        bitrate: prevMetadata?.bitrate || 0,
        sampleRate: prevMetadata?.sampleRate || 0,
        picture: prevMetadata?.picture || [],
      }));
    } catch (error) {
      console.error("Error updating tags:", error);
      throw error;
    }
  };

  const handleCoverUpload = (file: File) => {
    setCover(file);
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

  const handleDownloadUpdatedFile = () => {
    if (!audio) {
      return;
    }
    const url = URL.createObjectURL(audio);
    const a = document.createElement("a");
    a.href = url;
    a.download = audio.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-2xl space-y-6 flex flex-col items-center">
      {!audio && (
        <div className="flex flex-col gap-2">
          <Label>upload file</Label>
          <AudioUpload onAudioUpload={handleAudioUpload} />
        </div>
      )}

      {metadata && (
        <Card>
          <form onSubmit={handleSubmit(onSubmit)}>
            <CardHeader>
              <CardTitle>audio metadata</CardTitle>
              <CardDescription>edit tags/metadata</CardDescription>
              <CardAction className="flex pb-4 flex-col gap-2">
                <Label>upload new file</Label>
                <Button variant="outline" asChild>
                  <AudioUpload onAudioUpload={handleAudioUpload} />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="border-t pt-6">
              <div className="flex gap-4">
                <Controller
                  name="picture"
                  control={control}
                  defaultValue={metadata.picture}
                  render={({ field }) => (
                    <CoverArt
                      picture={metadata.picture}
                      onCoverUpload={handleCoverUpload}
                    />
                  )}
                />
                <div className="flex-1 grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      filename:
                    </label>
                    <Input
                      defaultValue={metadata.filename}
                      {...register("filename")}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      title:
                    </label>
                    <Input
                      defaultValue={metadata.title}
                      {...register("title")}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      artist:
                    </label>
                    <Input
                      defaultValue={metadata.artist}
                      {...register("artist")}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      album:
                    </label>
                    <Input
                      defaultValue={metadata.album}
                      {...register("album")}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      year:
                    </label>
                    <Input
                      defaultValue={metadata.year ?? ""}
                      {...register("year")}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      genre:
                    </label>
                    <Input
                      defaultValue={
                        metadata.genre
                          ? Array.isArray(metadata.genre)
                            ? metadata.genre.join(", ")
                            : metadata.genre
                          : ""
                      }
                      {...register("genre")}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        track:
                      </label>
                      <Input
                        defaultValue={metadata.trackNumber ?? ""}
                        {...register("trackNumber")}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm pt-2 border-t">
                    <div>
                      <span className="font-medium">duration: </span>
                      {`${Math.floor(metadata.duration / 60)}:${(
                        metadata.duration % 60
                      )
                        .toFixed(0)
                        .padStart(2, "0")}`}
                    </div>
                    <div>
                      <span className="font-medium">bitrate: </span>
                      {`${Math.round(metadata.bitrate)} kbps`}
                    </div>
                    <div>
                      <span className="font-medium">sample rate: </span>
                      {`${metadata.sampleRate} Hz`}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-center mt-6 border-t flex-col gap-2">
              <Button disabled={!audio} className="w-full" type="submit">
                update tags
              </Button>
              <Button
                disabled={!audio}
                className="w-full"
                variant="outline"
                onClick={() => handleDownloadUpdatedFile()}
              >
                download updated file
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}
    </div>
  );
}
