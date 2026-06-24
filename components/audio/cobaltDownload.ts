export type AudioDownloadBitrate = "320" | "256" | "128" | "96" | "64";

interface CobaltAudioDownloadRequest {
  sourceUrl: string;
  audioBitrate: AudioDownloadBitrate;
}

const getStableLastModified = (sourceUrl: string) =>
  Array.from(sourceUrl).reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) % 2_147_483_647;
  }, 1);

export async function downloadCobaltAudio({ sourceUrl, audioBitrate }: CobaltAudioDownloadRequest) {
  const response = await fetch("/api/cobalt/audio", {
    method: "POST",
    headers: {
      Accept: "audio/mpeg",
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

  const filename = response.headers.get("X-Tagium-Filename");
  if (!filename) {
    throw new Error("Tagium audio proxy missing filename.");
  }

  const blob = await response.blob();
  return new File([blob], decodeURIComponent(filename), {
    type: blob.type,
    lastModified: getStableLastModified(sourceUrl),
  });
}
