export const YOUTUBE_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
] as const;
export const SOUNDCLOUD_HOSTS = [
  "soundcloud.com",
  "www.soundcloud.com",
  "m.soundcloud.com",
] as const;
const youtubeSet = new Set<string>(YOUTUBE_HOSTS);
const soundcloudSet = new Set<string>(SOUNDCLOUD_HOSTS);
const videoId = /^[A-Za-z0-9_-]{11}$/;

export type MediaLinkKind = "canonical" | "short" | "mobile" | "nocookie" | "other";

export const mediaLinkKindFromUrl = (sourceUrl: string): MediaLinkKind => {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (host === "youtu.be" || host === "on.soundcloud.com" || host === "snd.sc") {
      return "short";
    }
    if (host === "m.youtube.com" || host === "music.youtube.com" || host === "m.soundcloud.com") {
      return "mobile";
    }
    if (host === "youtube-nocookie.com" || host === "www.youtube-nocookie.com") {
      return "nocookie";
    }
    if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "soundcloud.com" ||
      host === "www.soundcloud.com"
    ) {
      return "canonical";
    }
  } catch {
    // Invalid and generic inputs share the non-identifying "other" kind.
  }
  return "other";
};

export type ParsedMediaLink =
  | { provider: "youtube"; kind: "track"; canonicalUrl: string; videoId: string }
  | { provider: "youtube"; kind: "playlist"; canonicalUrl: string; playlistId: string }
  | { provider: "soundcloud"; kind: "track" | "playlist"; canonicalUrl: string }
  | { provider: "other"; kind: "unsupported"; canonicalUrl: string };

const unsupported = (url: URL): ParsedMediaLink => ({
  provider: "other",
  kind: "unsupported",
  canonicalUrl: url.toString(),
});
const youtubeTrack = (id: string): ParsedMediaLink | undefined =>
  videoId.test(id)
    ? {
        provider: "youtube",
        kind: "track",
        videoId: id,
        canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
      }
    : undefined;

export function parseMediaLink(input: string): ParsedMediaLink {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { provider: "other", kind: "unsupported", canonicalUrl: input.trim() };
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    return unsupported(url);
  const host = url.hostname.toLowerCase();
  if (host === "youtube-nocookie.com" || host === "www.youtube-nocookie.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const list = url.searchParams.get("list");
    if (
      parts[0] === "embed" &&
      list &&
      (parts[1] === "videoseries" || url.searchParams.get("listType") === "playlist")
    )
      return {
        provider: "youtube",
        kind: "playlist",
        playlistId: list,
        canonicalUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`,
      };
    if (parts[0] === "embed" && parts[1] && !parts[1].includes("videoseries"))
      return youtubeTrack(parts[1]) ?? unsupported(url);
    return unsupported(url);
  }
  if (host === "youtu.be" || youtubeSet.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const list = url.searchParams.get("list");
    if (
      youtubeSet.has(host) &&
      (parts[0] === "playlist" ||
        (parts[0] === "embed" &&
          (parts[1] === "videoseries" || url.searchParams.get("listType") === "playlist"))) &&
      list
    ) {
      return {
        provider: "youtube",
        kind: "playlist",
        playlistId: list,
        canonicalUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`,
      };
    }
    let id: string | undefined;
    if (host === "youtu.be") id = parts[0];
    else if (parts[0] === "watch") id = url.searchParams.get("v") ?? parts[1];
    else if (["shorts", "live", "embed", "v"].includes(parts[0] ?? "")) id = parts[1];
    else if (parts[0] === "attribution_link") {
      const raw = url.searchParams.get("u");
      if (raw?.startsWith("/") && !raw.startsWith("//"))
        return parseMediaLink(`https://${host}${raw}`);
    }
    return (id ? youtubeTrack(id) : undefined) ?? unsupported(url);
  }
  if (soundcloudSet.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      parts.length >= 3 &&
      parts.length <= 4 &&
      parts[1] === "sets" &&
      (parts.length === 3 || parts[3]?.startsWith("s-"))
    ) {
      const token =
        (parts[3]?.startsWith("s-") ? parts[3] : undefined) ??
        (url.searchParams.get("secret_token")?.startsWith("s-")
          ? url.searchParams.get("secret_token")!
          : undefined);
      const base = `https://soundcloud.com/${parts[0]}/sets/${parts[2]}`;
      return {
        provider: "soundcloud",
        kind: "playlist",
        canonicalUrl: token ? `${base}/${token}` : base,
      };
    }
    if (
      parts.length >= 2 &&
      parts.length <= 3 &&
      parts[0] &&
      !["stream", "discover", "you", "likes", "stations", "search", "sets"].includes(parts[0]) &&
      (parts.length === 2 || parts[2]?.startsWith("s-"))
    ) {
      const token =
        (parts[2]?.startsWith("s-") ? parts[2] : undefined) ??
        (url.searchParams.get("secret_token")?.startsWith("s-")
          ? url.searchParams.get("secret_token")!
          : undefined);
      const base = `https://soundcloud.com/${parts[0]}/${parts[1]}`;
      return {
        provider: "soundcloud",
        kind: "track",
        canonicalUrl: token ? `${base}/${token}` : base,
      };
    }
    return unsupported(url);
  }
  return unsupported(url);
}

export const isYouTubeHost = (host: string) => youtubeSet.has(host.toLowerCase());
export const isSoundCloudHost = (host: string) => soundcloudSet.has(host.toLowerCase());
