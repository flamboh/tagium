import { Schema } from "effect";
import { parseMediaLink } from "@/lib/media-link";

/** The largest persisted JSON manifest. Artwork bytes are deliberately not part of it. */
export const MAX_MANIFEST_PAYLOAD_BYTES = 256 * 1024;
export const MAX_MANIFEST_TRACKS = 100;
export const MAX_MANIFEST_STRING_LENGTH = 1_024;
export const MANIFEST_VERSION = 1;

const boundedString = (maximumLength = MAX_MANIFEST_STRING_LENGTH) =>
  Schema.String.pipe(Schema.refine((value): value is string => value.length <= maximumLength));

const requiredBoundedString = (maximumLength = MAX_MANIFEST_STRING_LENGTH) =>
  boundedString(maximumLength).pipe(Schema.refine((value): value is string => value.length > 0));

const positiveInteger = (minimum: number, maximum: number) =>
  Schema.Number.pipe(
    Schema.refine(
      (value): value is number =>
        Number.isInteger(value) && Number.isFinite(value) && value >= minimum && value <= maximum,
    ),
  );

const isSupportedSourceUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;

    const parsed = parseMediaLink(value);
    return parsed.kind !== "unsupported";
  } catch {
    return false;
  }
};

const sourceUrlSchema = requiredBoundedString(2_048).pipe(
  Schema.refine((value): value is string => isSupportedSourceUrl(value)),
);

const audioBitrateSchema = Schema.Literals(["320", "256", "128", "96", "64"]);

const artworkSchema = Schema.Struct({
  kind: Schema.Literal("stored"),
  format: Schema.Literals(["image/jpeg", "image/png"]),
  type: positiveInteger(0, 255),
  description: boundedString(256),
});

const metadataSchema = Schema.Struct({
  filename: requiredBoundedString(255),
  title: boundedString(),
  artist: boundedString(),
  album: boundedString(),
  genre: boundedString(),
  year: Schema.optionalKey(positiveInteger(1_000, 9_999)),
  trackNumber: Schema.optionalKey(positiveInteger(1, 9_999)),
});

const trackFields = {
  sourceUrl: sourceUrlSchema,
  audioBitrate: audioBitrateSchema,
  metadata: metadataSchema,
};

const trackSchema = Schema.Struct(trackFields);

const tracksSchema = Schema.Array(trackSchema).pipe(
  Schema.refine(
    (tracks): tracks is readonly Schema.Schema.Type<typeof trackSchema>[] =>
      tracks.length >= 1 && tracks.length <= MAX_MANIFEST_TRACKS,
  ),
);

const albumManifestSchema = Schema.Struct({
  version: Schema.Literal(MANIFEST_VERSION),
  kind: Schema.Literal("album"),
  album: Schema.Struct({
    title: boundedString(),
    artist: boundedString(),
    genre: boundedString(),
    year: Schema.optionalKey(positiveInteger(1_000, 9_999)),
    sourceUrl: Schema.optionalKey(sourceUrlSchema),
    artwork: Schema.optionalKey(artworkSchema),
  }),
  tracks: tracksSchema,
});

const trackManifestSchema = Schema.Struct({
  version: Schema.Literal(MANIFEST_VERSION),
  kind: Schema.Literal("track"),
  track: Schema.Struct({ ...trackFields, artwork: Schema.optionalKey(artworkSchema) }),
});

/**
 * Versioned, transport-safe representation of shared content. It intentionally
 * contains neither artwork bytes nor client-supplied artwork size/checksum data.
 */
export const manifestSchema = Schema.Union([albumManifestSchema, trackManifestSchema]);

export type Manifest = Schema.Schema.Type<typeof manifestSchema>;
export type AlbumManifest = Schema.Schema.Type<typeof albumManifestSchema>;
export type TrackManifest = Schema.Schema.Type<typeof trackManifestSchema>;
export type ManifestTrack = Schema.Schema.Type<typeof trackSchema>;
export type ManifestArtwork = Schema.Schema.Type<typeof artworkSchema>;
export type ManifestAudioBitrate = ManifestTrack["audioBitrate"];

export const manifestArtwork = (manifest: Manifest): ManifestArtwork | undefined =>
  manifest.kind === "album" ? manifest.album.artwork : manifest.track.artwork;

export const manifestTracks = (manifest: Manifest): readonly ManifestTrack[] =>
  manifest.kind === "album" ? manifest.tracks : [manifest.track];

export const manifestTrackCount = (manifest: Manifest) => manifestTracks(manifest).length;

export const SHARE_ANALYTICS_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const isShareAnalyticsId = (value: unknown): value is string =>
  typeof value === "string" && SHARE_ANALYTICS_ID_PATTERN.test(value);

/** HTTP responses intentionally serialize dates; milliseconds are storage-only. */
export interface SharePublicationResponse {
  slug: string;
  url: string;
  expiresAt: string;
  revocationToken: string;
  analyticsId: string;
}

export interface ShareManifestResponse {
  manifest: Manifest;
  expiresAt: string;
  analyticsId: string;
}

export const toShareExpiryIso = (expiresAt: number) => new Date(expiresAt).toISOString();

export const isShareExpiryIso = (value: unknown): value is string =>
  typeof value === "string" &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() === value;

export const manifestPayloadBytes = (manifest: Manifest) =>
  new TextEncoder().encode(JSON.stringify(manifest)).byteLength;

export const isManifestPayloadWithinLimit = (manifest: Manifest) =>
  manifestPayloadBytes(manifest) <= MAX_MANIFEST_PAYLOAD_BYTES;

/** Decodes only the supported version and rejects an oversized persisted payload. */
export const decodeManifest = (input: unknown): Manifest => {
  const manifest = Schema.decodeUnknownSync(manifestSchema)(input);
  if (!isManifestPayloadWithinLimit(manifest)) {
    throw new Error(`manifest payload must be ${MAX_MANIFEST_PAYLOAD_BYTES} bytes or smaller`);
  }
  return manifest;
};

/**
 * The richer input required to replay a manifest through the existing playlist
 * downloader without discarding track-specific tags, filenames, or bitrates.
 */
export interface ManifestReplayInput {
  sourceManifestSlug?: string;
  /** Structurally compatible with the existing provider Playlist input. */
  playlist: {
    title: string;
    artist: string;
    genre: string;
    year?: number;
    sourceUrl?: string;
    isAlbum: true;
    tracks: readonly { title: string; url: string; trackNumber: number }[];
  };
  tracks: readonly {
    sourceUrl: string;
    audioBitrate: ManifestAudioBitrate;
    metadata: ManifestTrack["metadata"];
  }[];
}

export const toManifestReplayInput = (
  manifest: Manifest,
  options: { sourceManifestSlug?: string } = {},
): ManifestReplayInput => {
  if (manifest.kind !== "album") throw new Error("track manifests cannot replay as albums");
  return {
    ...(options.sourceManifestSlug === undefined
      ? {}
      : { sourceManifestSlug: options.sourceManifestSlug }),
    playlist: {
      title: manifest.album.title,
      artist: manifest.album.artist,
      genre: manifest.album.genre,
      ...(manifest.album.year === undefined ? {} : { year: manifest.album.year }),
      ...(manifest.album.sourceUrl === undefined ? {} : { sourceUrl: manifest.album.sourceUrl }),
      isAlbum: true,
      tracks: manifest.tracks.map((track) => ({
        title: track.metadata.title,
        url: track.sourceUrl,
        trackNumber: track.metadata.trackNumber ?? 1,
      })),
    },
    tracks: manifest.tracks.map((track) => ({
      sourceUrl: track.sourceUrl,
      audioBitrate: track.audioBitrate,
      metadata: track.metadata,
    })),
  };
};

/** Projects current effective (including buffered) library metadata into a v1 manifest. */
export interface ManifestAlbumProjection {
  title: string;
  artist: string;
  genre: string;
  year?: number;
  sourceUrl?: string;
}

const supportedProvenance = (value: string | undefined) =>
  value !== undefined && value.length > 0 && value.length <= 2_048 && isSupportedSourceUrl(value)
    ? parseMediaLink(value).canonicalUrl
    : undefined;

export interface ManifestTrackProjection {
  filename: string;
  metadata?: {
    filename: string;
    title: string;
    artist: string;
    album: string;
    genre: string | readonly string[];
    year: number | null;
    trackNumber: number | null;
    duration?: number;
    bitrate?: number;
    sampleRate?: number;
    picture?: unknown;
  };
  pendingMetadataPatch?: {
    filename?: string;
    title?: string;
    artist?: string;
    album?: string;
    genre?: string | readonly string[];
    year?: number | null;
    trackNumber?: number | null;
  };
  downloadRequest?: { sourceUrl: string; audioBitrate: ManifestAudioBitrate };
}

export const projectManifestTrack = (file: ManifestTrackProjection): ManifestTrack => {
  if (!file.downloadRequest || !file.metadata) {
    throw new Error("only downloaded-source tracks with metadata can be shared");
  }
  const metadata = { ...file.metadata, ...file.pendingMetadataPatch };
  return {
    sourceUrl:
      supportedProvenance(file.downloadRequest.sourceUrl) ?? file.downloadRequest.sourceUrl,
    audioBitrate: file.downloadRequest.audioBitrate,
    metadata: {
      filename: metadata.filename || file.filename.replace(/\.mp3$/i, ""),
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      genre: typeof metadata.genre === "string" ? metadata.genre : metadata.genre.join(", "),
      ...(metadata.year === null ? {} : { year: metadata.year }),
      ...(metadata.trackNumber === null ? {} : { trackNumber: metadata.trackNumber }),
    },
  };
};

export const projectTrackManifest = (
  file: ManifestTrackProjection,
  artwork?: ManifestArtwork,
): TrackManifest =>
  decodeManifest({
    version: MANIFEST_VERSION,
    kind: "track",
    track: {
      ...projectManifestTrack(file),
      ...(artwork === undefined ? {} : { artwork }),
    },
  }) as TrackManifest;

export const projectAlbumManifest = (
  album: ManifestAlbumProjection,
  files: readonly ManifestTrackProjection[],
  artwork?: ManifestArtwork,
): AlbumManifest =>
  decodeManifest({
    version: MANIFEST_VERSION,
    kind: "album",
    album: {
      title: album.title,
      artist: album.artist,
      genre: album.genre,
      ...(album.year === undefined ? {} : { year: album.year }),
      ...(supportedProvenance(album.sourceUrl) === undefined
        ? {}
        : { sourceUrl: supportedProvenance(album.sourceUrl) }),
      ...(artwork === undefined ? {} : { artwork }),
    },
    tracks: files.map(projectManifestTrack),
  }) as AlbumManifest;
