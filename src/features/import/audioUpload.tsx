"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useId, useRef } from "react";
import { Upload } from "lucide-react";
import { AUDIO_UPLOAD_ACCEPT } from "@/features/audio/audioFormat";

interface AudioUploadProps {
  onAudioUpload: (audio: File[]) => void;
}

export default function AudioUpload({ onAudioUpload }: AudioUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onAudioUpload(files);
    }
    // Reset input value so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full">
      <Input
        type="file"
        id={inputId}
        className="hidden"
        accept={AUDIO_UPLOAD_ACCEPT}
        onChange={handleAudioUpload}
        multiple
        ref={fileInputRef}
      />
      <Button
        variant="outline"
        className="w-full cursor-pointer border-dashed border-2 h-12 hover:bg-accent/50 flex flex-col gap-2"
        onClick={handleButtonClick}
        aria-label="upload audio files"
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">upload MP3, FLAC, or M4A/MP4 files</span>
      </Button>
    </div>
  );
}
