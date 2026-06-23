"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { Download, Loader2, Link } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { downloadCobaltAudio, type AudioDownloadBitrate } from "./cobaltDownload";
import { isSoundCloudSetUrl, resolveSoundCloudSet, toImportedAlbumMetadata } from "./soundcloudSet";
import { ImportedAlbumMetadata } from "./types";

const bitrateOptions: AudioDownloadBitrate[] = ["320", "256", "128", "96", "64"];

const getDownloadErrorMessage = (error: Error) => {
  if (error.message.includes("COBALT_API_URL is not configured.")) {
    return "Set COBALT_API_URL on the Tagium server.";
  }

  if (error.message.includes("error.api.unreachable")) {
    return "Cobalt API unreachable. Run bun run dev:cobalt and set COBALT_API_URL.";
  }

  if (error.message.includes("error.api.timed_out")) {
    return "Cobalt API timed out.";
  }

  if (error.message.includes("error.tunnel.probe")) {
    return "Cobalt tunnel failed before download.";
  }

  return error.message;
};

interface AudioDownloaderProps {
  onAudioUpload: (audio: File[]) => void | Promise<void>;
  onAlbumDownload: (audio: File[], album: ImportedAlbumMetadata) => void | Promise<void>;
}

export default function AudioDownloader({ onAudioUpload, onAlbumDownload }: AudioDownloaderProps) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [audioBitrate, setAudioBitrate] = useState<AudioDownloadBitrate>("320");
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canDownload = sourceUrl.trim().length > 0 && !downloading;

  const handleDownload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedUrl = sourceUrl.trim();
    if (trimmedUrl.length === 0) {
      return;
    }

    setDownloading(true);
    setProgress(null);
    setError(null);

    try {
      if (isSoundCloudSetUrl(trimmedUrl)) {
        const set = await resolveSoundCloudSet(trimmedUrl);
        const downloadedFiles: File[] = [];

        for (const [index, track] of set.tracks.entries()) {
          setProgress(`${index + 1}/${set.tracks.length}`);
          downloadedFiles.push(
            await downloadCobaltAudio({
              sourceUrl: track.url,
              audioBitrate,
            }),
          );
        }

        await onAlbumDownload(downloadedFiles, toImportedAlbumMetadata(set));
        setSourceUrl("");
        return;
      }

      const file = await downloadCobaltAudio({
        sourceUrl: trimmedUrl,
        audioBitrate,
      });
      await onAudioUpload([file]);
      setSourceUrl("");
    } catch (caughtError) {
      let message = "Download failed.";
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
    <form className="flex flex-col gap-2" onSubmit={handleDownload}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Link className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="Paste media URL"
            className="pl-9"
            disabled={downloading}
          />
        </div>
        <select
          value={audioBitrate}
          onChange={(event) => setAudioBitrate(event.target.value as AudioDownloadBitrate)}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30"
          disabled={downloading}
          aria-label="Audio bitrate"
        >
          {bitrateOptions.map((bitrate) => (
            <option key={bitrate} value={bitrate}>
              {bitrate}
            </option>
          ))}
        </select>
        <Button type="submit" size="icon" disabled={!canDownload} aria-label="Download audio">
          {downloading && <Loader2 className="animate-spin" />}
          {!downloading && <Download />}
        </Button>
      </div>
      {progress && <p className="text-xs text-muted-foreground">Downloading {progress}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
