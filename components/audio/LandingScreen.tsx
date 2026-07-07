"use client";

import { useRef, useState } from "react";
import { Music4, Link2, ArrowRight, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDownloadErrorMessage, notifyDownloadError } from "./downloadErrorMessage";

interface LandingScreenProps {
  onAudioUpload: (files: File[]) => void | Promise<void>;
  onUrlImport: (sourceUrl: string) => void | Promise<void>;
}

export default function LandingScreen({ onAudioUpload, onUrlImport }: LandingScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [url, setUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || downloading) return;

    setDownloading(true);
    setError(null);

    try {
      await onUrlImport(trimmed);
      setUrl("");
    } catch (err) {
      if (err instanceof Error) {
        setError(getDownloadErrorMessage(err));
        notifyDownloadError(err);
      } else {
        setError("download failed.");
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className={cn(
        "h-full min-h-0 overflow-y-auto flex flex-col items-center justify-center p-8 transition-colors duration-200",
        isDragging && "bg-primary/5",
      )}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,audio/mpeg"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex flex-col items-center gap-10 w-full max-w-md max-lg:[@media(max-height:700px)]:gap-6">
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

        <div className="w-full flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex-1 h-px bg-border" />
          <span>or import from a url</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <form onSubmit={handleDownload} className="w-full flex flex-col gap-3">
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="url"
                name="landing-media-url"
                autoComplete="url"
                value={url}
                aria-label="media url"
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                placeholder="soundcloud or youtube url"
                disabled={downloading}
                className="w-full h-10 rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm shadow-sm outline-none focus:ring-2 focus:ring-ring transition-shadow disabled:opacity-50 placeholder:text-muted-foreground/45"
              />
            </div>
            <button
              type="submit"
              disabled={!url.trim() || downloading}
              aria-label="start media import"
              className="h-10 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
            </button>
          </div>

          {error && (
            <p className="text-xs text-destructive text-center" aria-live="polite">
              {error}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
