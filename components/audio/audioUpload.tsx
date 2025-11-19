"use client";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useState, useRef } from "react";
import { Upload } from "lucide-react";

interface AudioUploadProps {
  onAudioUpload: (audio: File[]) => void;
}

export default function AudioUpload({ onAudioUpload }: AudioUploadProps) {
  const [audio, setAudio] = useState<File[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const audioFiles = files.filter((file) => file.type.startsWith("audio/"));

    if (audioFiles.length > 0) {
      setAudio(audioFiles);
      onAudioUpload(audioFiles);
    }
    // Reset input value so the same file can be selected again if needed
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const handleButtonClick = () => {
    inputRef.current?.click();
  };

  return (
    <div>
      <Input
        type="file"
        id="audio"
        className="hidden"
        accept="audio/*"
        onChange={handleAudioUpload}
        multiple
        ref={inputRef}
      />
      <Button 
        variant="outline" 
        className="w-full cursor-pointer border-dashed border-2 h-12 hover:bg-accent/50 flex flex-col gap-2"
        onClick={handleButtonClick}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
      </Button>
    </div>
  );
}
