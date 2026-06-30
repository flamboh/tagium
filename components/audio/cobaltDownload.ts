export type AudioDownloadBitrate = "320" | "256" | "128" | "96" | "64";

export type CobaltDownloadPlan =
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

type LocalAudioProcessingRequest = {
  audioFile: File;
  audio: {
    copy: boolean;
    format: string;
    bitrate: string;
  };
  output: { type: string; format: string };
};

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
      TCOM?: string;
      TCOP?: string;
      TLAN?: string;
      TPE2?: string;
    };
  };
}

const getStableLastModified = (sourceUrl: string) =>
  Array.from(sourceUrl).reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) % 2_147_483_647;
  }, 1);

const fetchTunnelFile = async (url: string, filename: string, lastModified: number) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }

  let contentType = response.headers.get("Content-Type");
  if (!contentType) {
    contentType = "application/octet-stream";
  }
  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error("cobalt tunnel response was empty.");
  }

  return new File([blob], filename, {
    type: contentType,
    lastModified,
  });
};

const runLocalProcessingWorker = async (request: LocalAudioProcessingRequest) =>
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
      cobaltLocalProcessing: request,
    });
  });

export const validateLocalAudioPlan = (
  plan: Extract<CobaltDownloadPlan, { status: "local-processing" }>,
) => {
  if (plan.type !== "audio") {
    throw new Error("cobalt local processing response was not audio.");
  }
  if (!plan.audio) {
    throw new Error("cobalt local processing response missing audio settings.");
  }
  if (plan.audio.cropCover) {
    throw new Error("cobalt local processing response requested unsupported cover crop.");
  }
  if (plan.tunnel.length === 0) {
    throw new Error("cobalt local processing response missing audio tunnel.");
  }
  if (plan.tunnel.length > 2) {
    throw new Error("cobalt local processing response included unexpected tunnels.");
  }
  if (plan.tunnel.length === 2 && !plan.audio.cover) {
    throw new Error("cobalt local processing response included unexpected cover tunnel.");
  }
  if (plan.audio.cover && plan.tunnel.length !== 2) {
    throw new Error("cobalt local processing response missing cover tunnel.");
  }
};

const processLocalAudio = async (
  plan: Extract<CobaltDownloadPlan, { status: "local-processing" }>,
  lastModified: number,
) => {
  validateLocalAudioPlan(plan);

  const outputFormat = plan.output.filename.split(".").pop();
  if (!outputFormat) {
    throw new Error("cobalt local processing response missing output format.");
  }

  const audioTunnel = plan.tunnel[0];
  if (!audioTunnel) {
    throw new Error("cobalt local processing response missing audio tunnel.");
  }

  let audioFile: File;
  let coverFile: File | undefined;
  const coverTunnel = plan.tunnel[1];
  const audioFilePromise = fetchTunnelFile(audioTunnel, "input-0", lastModified);
  if (coverTunnel) {
    [audioFile, coverFile] = await Promise.all([
      audioFilePromise,
      fetchTunnelFile(coverTunnel, "input-1", lastModified),
    ]);
  } else {
    audioFile = await audioFilePromise;
  }

  const blob = await runLocalProcessingWorker({
    audioFile,
    audio: {
      copy: plan.audio.copy,
      format: plan.audio.format,
      bitrate: plan.audio.bitrate,
    },
    output: {
      type: plan.output.type,
      format: outputFormat,
    },
  });

  const file = new File([blob], plan.output.filename, {
    type: plan.output.type,
    lastModified,
  });

  return await tagCobaltAudioFile(file, plan, coverFile, lastModified);
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

  applyCobaltAudioMetadata(mp3tag, plan.output.metadata);

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

export const applyCobaltAudioMetadata = (
  mp3tag: Pick<MP3TagReader, "tags">,
  metadata: Record<string, string | undefined> | undefined,
) => {
  if (!metadata) {
    return;
  }

  if (metadata.title) {
    mp3tag.tags.title = metadata.title;
  }
  if (metadata.artist) {
    mp3tag.tags.artist = metadata.artist;
  }
  if (metadata.album) {
    mp3tag.tags.album = metadata.album;
  }
  if (metadata.date) {
    mp3tag.tags.year = metadata.date;
  }
  if (metadata.genre) {
    mp3tag.tags.genre = metadata.genre;
  }
  if (metadata.track) {
    mp3tag.tags.track = metadata.track;
  }

  const v2Frames = {
    album_artist: "TPE2",
    composer: "TCOM",
    copyright: "TCOP",
    sublanguage: "TLAN",
  } as const;

  for (const [metadataKey, frameName] of Object.entries(v2Frames)) {
    const value = metadata[metadataKey];
    if (value) {
      mp3tag.tags.v2 ??= {};
      mp3tag.tags.v2[frameName] = Array.from(value)
        .filter((character) => character.charCodeAt(0) > 9)
        .join("");
    }
  }
};

export async function downloadCobaltAudio({ sourceUrl, audioBitrate }: CobaltAudioDownloadRequest) {
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
    return await processLocalAudio(plan, lastModified);
  }

  return await fetchTunnelFile(plan.url, plan.filename, lastModified);
}
