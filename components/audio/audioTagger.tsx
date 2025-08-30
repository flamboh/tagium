"use client";

import { useState } from "react";
import { parseBlob } from "music-metadata";
import AudioUpload from "./audioUpload";
import { Button } from "../ui/button";

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

  return (
    <div className="w-full max-w-2xl space-y-6">
      <AudioUpload onAudioUpload={handleAudioUpload} />

      {loading && (
        <div className="text-center text-gray-600">Loading metadata...</div>
      )}

      {metadata && (
        <div className="bg-gray-50 p-4 rounded-lg space-y-2">
          <h3 className="font-semibold text-lg mb-3">Audio Metadata</h3>
          <div className="flex gap-4">
            <div className="flex-shrink-0">
              {metadata.picture && metadata.picture.length > 0 ? (
                <img
                  src={`data:${metadata.picture[0].format};base64,${btoa(
                    String.fromCharCode(...metadata.picture[0].data)
                  )}`}
                  alt="Album cover"
                  className="w-64 h-64 object-cover rounded-lg border"
                />
              ) : (
                <div className="w-64 h-64 bg-gray-200 rounded-lg border flex items-center justify-center text-gray-500 text-xs">
                  No cover
                </div>
              )}
            </div>
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <div>
                <span className="font-medium">Title:</span>{" "}
                {metadata.title || ""}
              </div>
              <div>
                <span className="font-medium">Artist:</span>{" "}
                {metadata.artist || ""}
              </div>
              <div>
                <span className="font-medium">Album:</span>{" "}
                {metadata.album || ""}
              </div>
              <div>
                <span className="font-medium">Year:</span> {metadata.year || ""}
              </div>
              <div>
                <span className="font-medium">Genre:</span>{" "}
                {metadata.genre && metadata.genre.length > 0
                  ? metadata.genre.join(", ")
                  : ""}
              </div>
              <div>
                <span className="font-medium">Duration:</span>{" "}
                {metadata.duration
                  ? `${Math.floor(metadata.duration / 60)}:${(
                      metadata.duration % 60
                    )
                      .toFixed(0)
                      .padStart(2, "0")}`
                  : ""}
              </div>
              <div>
                <span className="font-medium">Bitrate:</span>{" "}
                {metadata.bitrate ? `${Math.round(metadata.bitrate)} kbps` : ""}
              </div>
              <div>
                <span className="font-medium">Sample Rate:</span>{" "}
                {metadata.sampleRate ? `${metadata.sampleRate} Hz` : ""}
              </div>
              <div>
                <span className="font-medium">Track Number:</span>{" "}
                {metadata.trackNumber ? `${metadata.trackNumber}` : ""}
              </div>
              <div>
                <span className="font-medium">Track Total:</span>{" "}
                {metadata.trackTotal ? `${metadata.trackTotal}` : ""}
              </div>
              <div>
                <span className="font-medium">Disc Number:</span>{" "}
                {metadata.discNumber ? `${metadata.discNumber}` : ""}
              </div>
              <div>
                <span className="font-medium">Disc Total:</span>{" "}
                {metadata.discTotal ? `${metadata.discTotal}` : ""}
              </div>
            </div>
          </div>
        </div>
      )}

      <Button disabled={!audio}>update tags</Button>
    </div>
  );
}
