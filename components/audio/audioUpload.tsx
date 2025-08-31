"use client";

import { Button } from "../ui/button";
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
      <Button asChild variant="outline" className="file:truncate w-64">
        <Input
          type="file"
          id="audio"
          className=""
          accept="audio/*"
          onChange={handleAudioUpload}
          multiple
        />
      </Button>
    </div>
  );
}
