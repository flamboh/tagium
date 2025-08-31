"use client";

import { useState } from "react";
import { parseBlob } from "music-metadata";
import AudioUpload from "./audioUpload";
import CoverArt from "./coverArt";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AudioMetadata {
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string[];
  duration?: number;
  bitrate?: number;
  sampleRate?: number;
  picture?: {
    format: string;
    data: Uint8Array;
    description?: string;
  }[];
  trackNumber?: number;
  trackTotal?: number;
  discNumber?: number;
  discTotal?: number;
}

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
        title: audioMetadata.common.title,
        artist: audioMetadata.common.artist,
        album: audioMetadata.common.album,
        year: audioMetadata.common.year,
        genre: audioMetadata.common.genre,
        duration: audioMetadata.format.duration,
        bitrate: audioMetadata.format.bitrate,
        sampleRate: audioMetadata.format.sampleRate,
        picture: audioMetadata.common.picture,
        trackNumber: audioMetadata.common.track.no || undefined,
        trackTotal: audioMetadata.common.track.of || undefined,
        discNumber: audioMetadata.common.disk.no || undefined,
        discTotal: audioMetadata.common.disk.of || undefined,
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
    <div className="w-full max-w-2xl space-y-6">
      <AudioUpload onAudioUpload={handleAudioUpload} />

      {loading && (
        <div className="text-center text-gray-600">Loading metadata...</div>
      )}

      {metadata && (
        <Card>
          <CardHeader>
            <CardTitle>audio metadata</CardTitle>
            <CardAction>
              <Button variant="outline">upload new file</Button>
            </CardAction>
          </CardHeader>
          <CardContent className="border-t mt-8 pt-6">
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
                  <Input defaultValue={metadata.title || ""} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    artist:
                  </label>
                  <Input defaultValue={metadata.artist || ""} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    album:
                  </label>
                  <Input defaultValue={metadata.album || ""} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    year:
                  </label>
                  <Input
                    defaultValue={metadata.year?.toString() || ""}
                    type="number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    genre:
                  </label>
                  <Input
                    defaultValue={
                      metadata.genre && metadata.genre.length > 0
                        ? metadata.genre.join(", ")
                        : ""
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      track:
                    </label>
                    <Input
                      defaultValue={metadata.trackNumber?.toString() || ""}
                      type="number"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">of</label>
                    <Input
                      defaultValue={metadata.trackTotal?.toString() || ""}
                      type="number"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      disc:
                    </label>
                    <Input
                      defaultValue={metadata.discNumber?.toString() || ""}
                      type="number"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">of</label>
                    <Input
                      defaultValue={metadata.discTotal?.toString() || ""}
                      type="number"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm pt-2 border-t">
                  <div>
                    <span className="font-medium">duration:</span>{" "}
                    {metadata.duration
                      ? `${Math.floor(metadata.duration / 60)}:${(
                          metadata.duration % 60
                        )
                          .toFixed(0)
                          .padStart(2, "0")}`
                      : ""}
                  </div>
                  <div>
                    <span className="font-medium">bitrate:</span>{" "}
                    {metadata.bitrate
                      ? `${Math.round(metadata.bitrate)} kbps`
                      : ""}
                  </div>
                  <div>
                    <span className="font-medium">sample rate:</span>{" "}
                    {metadata.sampleRate ? `${metadata.sampleRate} Hz` : ""}
                  </div>
                </div>
              </div>
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
