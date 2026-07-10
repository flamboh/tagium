"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDownloadErrorMessage, notifyDownloadError } from "./downloadErrorMessage";

interface AudioDownloaderProps {
  onUrlImport: (sourceUrl: string) => void | Promise<void>;
}

export default function AudioDownloader({ onUrlImport }: AudioDownloaderProps) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canDownload = sourceUrl.trim().length > 0 && !downloading;

  const handleDownload = async () => {
    if (!canDownload) {
      return;
    }

    const trimmedUrl = sourceUrl.trim();

    setDownloading(true);
    setError(null);

    try {
      await onUrlImport(trimmedUrl);
      setSourceUrl("");
    } catch (caughtError) {
      let message = "download failed.";
      if (caughtError instanceof Error) {
        message = getDownloadErrorMessage(caughtError);
        notifyDownloadError(caughtError);
      }
      setError(message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Link className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="url"
            name="media-url"
            autoComplete="url"
            aria-label="media url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleDownload();
              }
            }}
            placeholder="soundcloud or youtube url"
            className="pl-9 placeholder:text-muted-foreground/45"
            disabled={downloading}
          />
        </div>
        <Button
          type="button"
          size="icon"
          disabled={!canDownload}
          aria-label="start media import"
          onClick={() => void handleDownload()}
        >
          {downloading && <Loader2 className="animate-spin" />}
          {!downloading && <ArrowRight />}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-destructive" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
