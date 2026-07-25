"use client";

import { useEffect, useRef, useState } from "react";
import { Music4, Upload } from "lucide-react";
import { AUDIO_UPLOAD_ACCEPT } from "@/features/audio/audioFormat";
import { cn } from "@/lib/utils";

export interface AudioImportDropzoneProps {
  onAudioUpload: (files: File[]) => void | Promise<void>;
  showBrand?: boolean;
  className?: string;
}

const handleDragOver = (event: React.DragEvent<HTMLButtonElement>) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
};

export default function AudioImportDropzone({
  onAudioUpload,
  showBrand = false,
  className,
}: AudioImportDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const importFiles = (files: FileList | File[] | null) => {
    const audioFiles = Array.from(files ?? []);
    if (audioFiles.length > 0) void onAudioUpload(audioFiles);
  };

  const resetDragState = () => {
    dragCounterRef.current = 0;
    setIsDragging(false);
  };

  useEffect(() => {
    if (!isDragging || typeof window === "undefined" || typeof document === "undefined") return;

    const handleDocumentDragLeave = (event: DragEvent) => {
      if (!event.relatedTarget) resetDragState();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) resetDragState();
    };

    window.addEventListener("blur", resetDragState);
    document.addEventListener("dragend", resetDragState);
    document.addEventListener("dragleave", handleDocumentDragLeave);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("blur", resetDragState);
      document.removeEventListener("dragend", resetDragState);
      document.removeEventListener("dragleave", handleDocumentDragLeave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isDragging]);

  return (
    <div
      className={cn(
        "flex w-full max-w-md flex-col items-center gap-10 max-lg:[@media(max-height:700px)]:gap-6",
        className,
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={AUDIO_UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          importFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {showBrand && (
        <div className="select-none text-center">
          <h1 className="text-7xl font-bold tracking-[-0.04em] text-foreground">tagium</h1>
          <p className="mt-3 text-base text-muted-foreground">tag your music</p>
        </div>
      )}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          dragCounterRef.current += 1;
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
          if (dragCounterRef.current === 0) setIsDragging(false);
        }}
        onDragOver={handleDragOver}
        onDragEnd={resetDragState}
        onDrop={(event) => {
          event.preventDefault();
          resetDragState();
          importFiles(event.dataTransfer.files);
        }}
        className={cn(
          "flex w-full cursor-pointer flex-col items-center justify-center gap-5 rounded-3xl border-2 border-dashed px-8 py-16 outline-none transition-[border-color,background-color,box-shadow,transform] duration-200 motion-reduce:transition-none max-lg:[@media(max-height:700px)]:gap-3 max-lg:[@media(max-height:700px)]:py-8",
          isDragging
            ? "scale-[1.015] border-primary bg-primary/10 shadow-lg shadow-primary/10 motion-reduce:scale-100"
            : "border-border hover:border-primary/50 hover:bg-accent/20 focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        {isDragging ? (
          <Music4 aria-hidden="true" className="size-14 text-primary" />
        ) : (
          <div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
            <Upload aria-hidden="true" className="size-7 text-muted-foreground" />
          </div>
        )}
        <div className="select-none text-center">
          <p className="text-lg font-semibold text-foreground">
            {isDragging ? "drop to import" : "drop your audio here"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            MP3, FLAC, and M4A/MP4 · or click to browse
          </p>
        </div>
      </button>
    </div>
  );
}
