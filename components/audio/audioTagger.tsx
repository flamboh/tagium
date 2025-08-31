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
import TagForm from "./tagForm";
import { SubmitHandler, useForm } from "react-hook-form";
import { Input } from "../ui/input";

const audioMetadataSchema = z.object({
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  year: z.number(),
  genre: z.string().or(z.array(z.string())),
  duration: z.number(),
  bitrate: z.number(),
  sampleRate: z.number(),
  picture: z.array(z.custom<IPicture>()),
  trackNumber: z.number(),
  trackTotal: z.number(),
  discNumber: z.number(),
  discTotal: z.number(),
});

export type AudioMetadata = z.infer<typeof audioMetadataSchema>;

export default function AudioTagger() {
  const [audio, setAudio] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [cover, setCover] = useState<File | null>(null);
  const { register, handleSubmit } = useForm<AudioMetadata>();

  const onSubmit: SubmitHandler<AudioMetadata> = (data) => {
    console.log(data);
  };

  const handleAudioUpload = async (file: File) => {
    setAudio(file);
    setLoading(true);
    try {
      const audioMetadata = await parseBlob(file);
      setMetadata({
        title: audioMetadata.common.title || "",
        artist: audioMetadata.common.artist || "",
        album: audioMetadata.common.album || "",
        year: audioMetadata.common.year || 0,
        genre: audioMetadata.common.genre || "",
        duration: audioMetadata.format.duration || 0,
        bitrate: audioMetadata.format.bitrate || 0,
        sampleRate: audioMetadata.format.sampleRate || 0,
        picture: audioMetadata.common.picture || [],
        trackNumber: audioMetadata.common.track.no || 0,
        trackTotal: audioMetadata.common.track.of || 0,
        discNumber: audioMetadata.common.disk.no || 0,
        discTotal: audioMetadata.common.disk.of || 0,
      });
    } catch (error) {
      console.error("Error parsing metadata:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCoverUpload = (file: File) => {
    setCover(file);
  };

  return (
    <div className="w-full max-w-2xl space-y-6 flex flex-col items-center">
      {!audio && (
        <div className="flex flex-col gap-2">
          <Label>upload file</Label>
          <AudioUpload onAudioUpload={handleAudioUpload} />
        </div>
      )}
      {/* {loading && (
        <div className="text-center text-gray-600">Loading metadata...</div>
      )} */}

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
                <CoverArt
                  picture={metadata.picture}
                  onCoverUpload={handleCoverUpload}
                />
                <div className="flex-1 grid grid-cols-1 gap-3">
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
                      defaultValue={metadata.year}
                      type="number"
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
                        defaultValue={metadata.trackNumber}
                        type="number"
                        {...register("trackNumber")}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        of
                      </label>
                      <Input
                        defaultValue={metadata.trackTotal}
                        type="number"
                        {...register("trackTotal")}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        disc:
                      </label>
                      <Input
                        defaultValue={metadata.discNumber}
                        type="number"
                        {...register("discNumber")}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        of
                      </label>
                      <Input
                        defaultValue={metadata.discTotal}
                        type="number"
                        {...register("discTotal")}
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
            <CardFooter className="flex justify-center mt-6 border-t">
              <Button disabled={!audio} className="w-full" type="submit">
                update tags
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}
    </div>
  );
}
