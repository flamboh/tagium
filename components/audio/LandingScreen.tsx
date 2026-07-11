"use client";

import { useRef, useState, type ReactNode } from "react";
import { Music4, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface LandingScreenProps {
  active: boolean;
  children: ReactNode;
  onAudioUpload: (files: File[]) => void | Promise<void>;
}

export default function LandingScreen({ active, children, onAudioUpload }: LandingScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("audio/"));
    if (dropped.length > 0) void onAudioUpload(dropped);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length > 0) void onAudioUpload(picked);
    e.target.value = "";
  };

  return (
    <div
      className={cn(
        active
          ? "h-svh min-h-0 overflow-y-auto flex flex-col items-center justify-center p-8 transition-colors duration-200 max-lg:[@media(max-height:700px)]:p-4 md:h-auto md:flex-1"
          : "contents",
        active && isDragging && "bg-primary/5",
      )}
      onDragEnter={active ? handleDragEnter : undefined}
      onDragLeave={active ? handleDragLeave : undefined}
      onDragOver={active ? handleDragOver : undefined}
      onDrop={active ? handleDrop : undefined}
    >
      {active && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,audio/mpeg"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
      )}

      <div
        className={
          active
            ? "flex w-full max-w-md flex-col items-center gap-10 max-lg:[@media(max-height:700px)]:gap-6"
            : "contents"
        }
      >
        {active && (
          <>
            <div className="text-center select-none">
              <h1 className="text-7xl font-bold tracking-tighter text-foreground">tagium</h1>
              <p className="text-muted-foreground mt-3 text-base">tag your music</p>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "w-full rounded-3xl border-2 border-dashed transition-all duration-200 cursor-pointer",
                "flex flex-col items-center justify-center gap-5 py-16 px-8 outline-none max-lg:[@media(max-height:700px)]:gap-3 max-lg:[@media(max-height:700px)]:py-8",
                isDragging
                  ? "border-primary bg-primary/10 scale-[1.015] shadow-xl shadow-primary/10"
                  : "border-border hover:border-primary/50 hover:bg-accent/20 focus-visible:border-primary/50",
              )}
            >
              {isDragging ? (
                <Music4 className="h-14 w-14 text-primary" />
              ) : (
                <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
                  <Upload className="h-7 w-7 text-muted-foreground" />
                </div>
              )}
              <div className="text-center">
                <p className="text-lg font-semibold text-foreground">
                  {isDragging ? "drop to import" : "drop your mp3s here"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">or click to browse files</p>
              </div>
            </button>
          </>
        )}
        {children}
      </div>
    </div>
  );
}
