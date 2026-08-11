import {
  manifestArtwork,
  manifestTrackCount,
  type Manifest,
} from "../../src/features/share/shareManifest";

export const SHARE_LINK_PREVIEW_START = "<!-- tagium:link-preview:start -->";
export const SHARE_LINK_PREVIEW_END = "<!-- tagium:link-preview:end -->";

export interface ShareLinkPreviewMetadata {
  title: string;
  description: string;
  url: string;
  image?: {
    url: string;
    alt: string;
  };
  twitterImage: {
    url: string;
    alt: string;
  };
  twitterTitle: string;
}

const contentForManifest = (manifest: Manifest) =>
  manifest.kind === "album"
    ? {
        title: manifest.album.title.trim() || "untitled album",
        artist: manifest.album.artist.trim() || "unknown artist",
      }
    : {
        title: manifest.track.metadata.title.trim() || "untitled track",
        artist: manifest.track.metadata.artist.trim() || "unknown artist",
      };

/** Project a public share into the small metadata surface understood by link crawlers. */
export const buildShareLinkPreviewMetadata = (
  manifest: Manifest,
  slug: string,
  requestUrl: string,
): ShareLinkPreviewMetadata => {
  const content = contentForManifest(manifest);
  const canonicalUrl = new URL(`/share/${encodeURIComponent(slug)}`, requestUrl);
  const artwork = manifestArtwork(manifest);
  const trackCount = manifestTrackCount(manifest);
  const description =
    manifest.kind === "album"
      ? `${content.artist} · ${trackCount} ${trackCount === 1 ? "track" : "tracks"} · shared on tagium`
      : `${content.artist} · shared track on tagium`;
  const image = artwork
    ? {
        url: new URL(`/api/manifests/${encodeURIComponent(slug)}/preview-artwork`, canonicalUrl)
          .href,
        alt: `${content.title} ${manifest.kind === "album" ? "cover" : "artwork"}`,
      }
    : {
        url: new URL("/icon-512.png", canonicalUrl).href,
        alt: "tagium",
      };

  return {
    title: content.title,
    description,
    url: canonicalUrl.href,
    image,
    twitterImage: {
      url: new URL(`/api/manifests/${encodeURIComponent(slug)}/social-card`, canonicalUrl).href,
      alt: `${content.title} by ${content.artist}`,
    },
    twitterTitle: `${content.title} - ${content.artist}`,
  };
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const meta = (attribute: "name" | "property", key: string, content: string) =>
  `<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`;

export const renderShareLinkPreviewTags = (metadata: ShareLinkPreviewMetadata) => {
  const tags = [
    `<title>${escapeHtml(`${metadata.title} · tagium`)}</title>`,
    meta("name", "description", metadata.description),
    meta("property", "og:title", metadata.title),
    meta("property", "og:description", metadata.description),
    meta("property", "og:type", "website"),
    meta("property", "og:url", metadata.url),
    meta("property", "og:site_name", "tagium"),
  ];

  if (metadata.image) {
    tags.push(
      meta("property", "og:image", metadata.image.url),
      meta("property", "og:image:alt", metadata.image.alt),
    );
  }

  tags.push(
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", metadata.twitterTitle),
    meta("name", "twitter:description", metadata.description),
    meta("name", "twitter:image", metadata.twitterImage.url),
    meta("name", "twitter:image:alt", metadata.twitterImage.alt),
  );

  tags.push(`<link rel="canonical" href="${escapeHtml(metadata.url)}" />`);
  return `${SHARE_LINK_PREVIEW_START}\n    ${tags.join("\n    ")}\n    ${SHARE_LINK_PREVIEW_END}`;
};

/** Replace the one static metadata block while leaving Vite's transformed SPA shell intact. */
export const injectShareLinkPreview = (html: string, metadata: ShareLinkPreviewMetadata) => {
  const start = html.indexOf(SHARE_LINK_PREVIEW_START);
  const end = html.indexOf(SHARE_LINK_PREVIEW_END, start);
  if (start === -1 || end === -1) return html;
  return `${html.slice(0, start)}${renderShareLinkPreviewTags(metadata)}${html.slice(
    end + SHARE_LINK_PREVIEW_END.length,
  )}`;
};
