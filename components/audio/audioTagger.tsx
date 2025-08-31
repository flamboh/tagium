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
          <CardHeader>
            <CardTitle>audio metadata</CardTitle>
            <CardDescription>edit tags/metadata</CardDescription>
            <CardAction className="flex  flex-col gap-2">
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
              <TagForm metadata={metadata} />
            </div>
          </CardContent>
          <CardFooter className="flex justify-center mt-6 border-t">
            <Button disabled={!audio} className="w-full">
              update tags
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
