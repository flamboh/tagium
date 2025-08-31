"use client";

import { Input } from "../ui/input";
import { useState } from "react";

interface AudioUploadProps {
  onAudioUpload: (audio: File) => void;
}

export default function AudioUpload({ onAudioUpload }: AudioUploadProps) {
  const [audio, setAudio] = useState<File | null>(null);

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = e.target.files?.[0];

    if (audio && audio.type.startsWith("audio/")) {
      setAudio(audio);
      onAudioUpload(audio);
    }
  };

  return (
    <div>
      <Input
        type="file"
        id="audio"
        className="w-full max-w-md"
        accept="audio/*"
        onChange={handleAudioUpload}
        multiple
      />
    </div>
  );
}
