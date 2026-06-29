export type AudioDownloadBitrate = "320" | "256" | "128" | "96" | "64";

type CobaltDownloadPlan =
  | {
      status: "tunnel";
      url: string;
      filename: string;
    }
  | {
      status: "local-processing";
      type: "audio";
      tunnel: string[];
      output: {
        type: string;
        filename: string;
        metadata?: Record<string, string | undefined>;
      };
      audio: {
        copy: boolean;
        format: string;
        bitrate: string;
        cover?: boolean;
        cropCover?: boolean;
      };
    };

interface CobaltAudioDownloadRequest {
  sourceUrl: string;
  audioBitrate: AudioDownloadBitrate;
}

export type CobaltDownloadProgress =
  | {
      phase: "download";
      receivedBytes: number;
      totalBytes?: number;
    }
  | {
      phase: "processing";
    };

export interface CobaltDownloadOptions {
  onProgress?: (progress: CobaltDownloadProgress) => void;
}

interface MP3TagPicture {
  format: string;
  type: number;
  description: string;
  data: number[];
}

interface MP3TagReader {
  read: () => void;
  save?: () => void;
  error?: string;
  buffer?: ArrayBuffer;
  tags: {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    track?: string;
    v2?: {
      APIC?: MP3TagPicture[];
    };
  };
}

const cobaltFileMetadataKeys = [
  "album",
  "composer",
  "genre",
  "copyright",
  "title",
  "artist",
  "album_artist",
  "track",
  "date",
  "sublanguage",
];

const getStableLastModified = (sourceUrl: string) =>
  Array.from(sourceUrl).reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) % 2_147_483_647;
  }, 1);

const stripMetadataControlCharacters = (value: string) =>
  Array.from(value)
    .filter((character) => character.charCodeAt(0) > 9)
    .join("");

const ffmpegMetadataArgs = (metadata: Record<string, string | undefined>) =>
  Object.entries(metadata).flatMap(([name, value]) => {
    if (!cobaltFileMetadataKeys.includes(name) || !value) {
      return [];
    }

    if (name === "sublanguage") {
      return ["-metadata:s:s:0", `language=${stripMetadataControlCharacters(value)}`];
    }

    return ["-metadata", `${name}=${stripMetadataControlCharacters(value)}`];
  });

const makeAudioArgs = (plan: Extract<CobaltDownloadPlan, { status: "local-processing" }>) => {
  const ffargs = ["-vn"];

  ffargs.push(
    ...(plan.audio.copy ? ["-c:a", "copy"] : ["-b:a", `${plan.audio.bitrate}k`]),
    ...(plan.output.metadata ? ffmpegMetadataArgs(plan.output.metadata) : []),
  );

  if (plan.audio.format === "mp3" && plan.audio.bitrate === "8") {
    ffargs.push("-ar", "12000");
  }

  if (plan.audio.format === "opus") {
    ffargs.push("-vbr", "off");
  }

  ffargs.push("-f", plan.audio.format === "m4a" ? "ipod" : plan.audio.format);
  return ffargs;
};

export const fetchTunnelFile = async (
  url: string,
  filename: string,
  lastModified: number,
  options: CobaltDownloadOptions = {},
) => {
  const { onProgress } = options;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }

  let contentType = response.headers.get("Content-Type");
  if (!contentType) {
    contentType = "application/octet-stream";
  }
  let totalBytes: number | undefined;
  const contentLength = response.headers.get("Content-Length");
  if (contentLength) {
    const parsedContentLength = Number(contentLength);
    if (Number.isFinite(parsedContentLength) && parsedContentLength > 0) {
      totalBytes = parsedContentLength;
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("cobalt tunnel response was empty.");
  }

  let receivedBytes = 0;
  const chunks: ArrayBuffer[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    receivedBytes += chunk.value.byteLength;
    chunks.push(new Uint8Array(chunk.value).buffer);
    onProgress?.({
      phase: "download",
      receivedBytes,
      totalBytes,
    });
  }

  const blob = new Blob(chunks, { type: contentType });
  if (blob.size === 0) {
    throw new Error("cobalt tunnel response was empty.");
  }

  return new File([blob], filename, {
    type: contentType,
    lastModified,
  });
};

const runLocalProcessingWorker = async (
  files: File[],
  args: string[],
  output: { type: string; format: string },
) =>
  new Promise<Blob>((resolve, reject) => {
    const worker = new Worker(new URL("./cobaltLocalProcessingWorker.js", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event: MessageEvent) => {
      const message = event.data.cobaltLocalProcessing;
      if (message?.blob) {
        worker.terminate();
        resolve(message.blob);
        return;
      }

      if (message?.error) {
        worker.terminate();
        reject(new Error(message.error));
      }
    };

    worker.onerror = (error) => {
      worker.terminate();
      reject(new Error(error.message));
    };

    worker.postMessage({
      cobaltLocalProcessing: {
        files,
        args,
        output,
      },
    });
  });

const processLocalAudio = async (
  plan: Extract<CobaltDownloadPlan, { status: "local-processing" }>,
  lastModified: number,
  options: CobaltDownloadOptions,
) => {
  const { onProgress } = options;
  const receivedBytes = plan.tunnel.map(() => 0);
  const totalBytes = plan.tunnel.map(() => undefined as number | undefined);
  const progressForTunnel = (index: number) => (progress: CobaltDownloadProgress) => {
    if (progress.phase === "processing") {
      return;
    }

    receivedBytes[index] = progress.receivedBytes;
    totalBytes[index] = progress.totalBytes;

    const totalReceivedBytes = receivedBytes.reduce((sum, value) => sum + value, 0);
    let aggregateTotalBytes = 0;
    for (const tunnelTotalBytes of totalBytes) {
      if (!tunnelTotalBytes) {
        onProgress?.({
          phase: "download",
          receivedBytes: totalReceivedBytes,
        });
        return;
      }

      aggregateTotalBytes += tunnelTotalBytes;
    }

    onProgress?.({
      phase: "download",
      receivedBytes: totalReceivedBytes,
      totalBytes: aggregateTotalBytes,
    });
  };

  const inputFiles = await Promise.all(
    plan.tunnel.map((url, index) =>
      fetchTunnelFile(url, `input-${index}`, lastModified, {
        onProgress: progressForTunnel(index),
      }),
    ),
  );
  onProgress?.({ phase: "processing" });

  const outputFormat = plan.output.filename.split(".").pop();
  if (!outputFormat) {
    throw new Error("cobalt local processing response missing output format.");
  }

  const audioFile = inputFiles[0];
  if (!audioFile) {
    throw new Error("cobalt local processing response missing audio tunnel.");
  }

  const blob = await runLocalProcessingWorker([audioFile], makeAudioArgs(plan), {
    type: plan.output.type,
    format: outputFormat,
  });

  const file = new File([blob], plan.output.filename, {
    type: plan.output.type,
    lastModified,
  });

  return await tagCobaltAudioFile(file, plan, inputFiles[1], lastModified);
};

const tagCobaltAudioFile = async (
  file: File,
  plan: Extract<CobaltDownloadPlan, { status: "local-processing" }>,
  coverFile: File | undefined,
  lastModified: number,
) => {
  const MP3Tag = (await import("mp3tag.js")).default;
  const mp3tag = new MP3Tag(await file.arrayBuffer(), true) as unknown as MP3TagReader;
  mp3tag.read();

  if (mp3tag.error) {
    throw new Error(mp3tag.error);
  }

  const metadata = plan.output.metadata;
  if (metadata?.title) {
    mp3tag.tags.title = metadata.title;
  }
  if (metadata?.artist) {
    mp3tag.tags.artist = metadata.artist;
  }
  if (metadata?.album) {
    mp3tag.tags.album = metadata.album;
  }
  if (metadata?.date) {
    mp3tag.tags.year = metadata.date;
  }
  if (metadata?.genre) {
    mp3tag.tags.genre = metadata.genre;
  }
  if (metadata?.track) {
    mp3tag.tags.track = metadata.track;
  }

  if (coverFile) {
    mp3tag.tags.v2 ??= {};
    mp3tag.tags.v2.APIC = [
      {
        format: coverFile.type,
        type: 3,
        description: "cover",
        data: Array.from(new Uint8Array(await coverFile.arrayBuffer())),
      },
    ];
  }

  mp3tag.save?.();
  if (mp3tag.error || !mp3tag.buffer) {
    throw new Error(mp3tag.error ?? "unable to save metadata");
  }

  return new File([new Uint8Array(mp3tag.buffer)], plan.output.filename, {
    type: file.type,
    lastModified,
  });
};

export async function downloadCobaltAudio(
  { sourceUrl, audioBitrate }: CobaltAudioDownloadRequest,
  options: CobaltDownloadOptions = {},
) {
  const response = await fetch("/api/cobalt/audio", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: sourceUrl,
      audioBitrate,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const plan = (await response.json()) as CobaltDownloadPlan;
  const lastModified = getStableLastModified(sourceUrl);

  if (plan.status === "local-processing") {
    return await processLocalAudio(plan, lastModified, options);
  }

  return await fetchTunnelFile(plan.url, plan.filename, lastModified, options);
}
