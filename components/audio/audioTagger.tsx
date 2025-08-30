"use client";

import { useState } from "react";
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
}

export default function AudioTagger() {
  const [audio, setAudio] = useState<File | null>(null);

  return (
    <div>
      <AudioUpload onAudioUpload={setAudio} />
      <Button>update tags</Button>
    </div>
  );
}
