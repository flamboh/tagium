"use client";

import { useState } from "react";
import { Download, Loader2, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDownloadErrorMessage } from "./downloadErrorMessage";
import { isSoundCloudSetUrl, resolveSoundCloudSet, type SoundCloudSet } from "./soundcloudSet";

interface AudioDownloaderProps {
  onAudioDownload: (sourceUrl: string) => void | Promise<void>;
  onSoundCloudSetDownload: (set: SoundCloudSet) => void | Promise<void>;
}

export default function AudioDownloader({
  onAudioDownload,
  onSoundCloudSetDownload,
}: AudioDownloaderProps) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canDownload = sourceUrl.trim().length > 0 && !downloading;

  const handleDownload = async () => {
    if (!canDownload) {
      return;
    }

    const trimmedUrl = sourceUrl.trim();

    setDownloading(true);
    setProgress(null);
    setError(null);

    try {
      if (isSoundCloudSetUrl(trimmedUrl)) {
        const set = await resolveSoundCloudSet(trimmedUrl);
        setProgress(`${set.tracks.length} tracks`);
        await onSoundCloudSetDownload(set);
        setSourceUrl("");
        return;
      }

      await onAudioDownload(trimmedUrl);
      setSourceUrl("");
    } catch (caughtError) {
      let message = "download failed.";
      if (caughtError instanceof Error) {
        message = getDownloadErrorMessage(caughtError);
      }
      setError(message);
    } finally {
      setProgress(null);
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
            placeholder="paste media url"
            className="pl-9"
            disabled={downloading}
          />
        </div>
        <Button
          type="button"
          size="icon"
          disabled={!canDownload}
          aria-label="download audio"
          onClick={() => void handleDownload()}
        >
          {downloading && <Loader2 className="animate-spin" />}
          {!downloading && <Download />}
        </Button>
      </div>
      {progress && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          downloading {progress}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
