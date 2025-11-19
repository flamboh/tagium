"use client";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useRef } from "react";
import { Upload } from "lucide-react";

interface AudioUploadProps {
  onAudioUpload: (audio: File[]) => void;
}

export default function AudioUpload({ onAudioUpload }: AudioUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    // The accept="audio/*" attribute on the Input component already filters for audio files.
    // No need for explicit filtering here unless more specific audio types are required.

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
        id="audio"
        className="hidden"
        accept="audio/*"
        onChange={handleAudioUpload}
        multiple
        ref={fileInputRef}
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
