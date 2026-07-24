import type { AppSettings, MetadataLinks } from "@/features/library/types";

export type MetadataLinkId = keyof MetadataLinks | "trackNumber";
export type MetadataLinkState = Record<MetadataLinkId, boolean>;

export interface MetadataLinkDescriptor {
  id: MetadataLinkId;
  label: string;
  relation: string;
  disabledReason: string;
  analyticsProperty:
    | "link_artist"
    | "link_year"
    | "link_genre"
    | "link_artwork"
    | "sync_track_numbers"
    | "link_album_artist";
  setting: { kind: "metadataLink"; key: keyof MetadataLinks } | { kind: "trackNumbers" };
  requiresAdvancedMetadata?: true;
}

const descriptorById = {
  artist: {
    id: "artist",
    label: "link artist to album",
    relation: "artist follows the album artist",
    disabledReason: "Artist is synced with the album.",
    analyticsProperty: "link_artist",
    setting: { kind: "metadataLink", key: "artist" },
  },
  year: {
    id: "year",
    label: "link year to album",
    relation: "year follows the album year",
    disabledReason: "Year is synced with the album.",
    analyticsProperty: "link_year",
    setting: { kind: "metadataLink", key: "year" },
  },
  genre: {
    id: "genre",
    label: "link genre to album",
    relation: "genre follows the album genre",
    disabledReason: "Genre is synced with the album.",
    analyticsProperty: "link_genre",
    setting: { kind: "metadataLink", key: "genre" },
  },
  artwork: {
    id: "artwork",
    label: "link artwork to album",
    relation: "artwork follows the album cover",
    disabledReason: "Artwork is synced with the album.",
    analyticsProperty: "link_artwork",
    setting: { kind: "metadataLink", key: "artwork" },
  },
  trackNumber: {
    id: "trackNumber",
    label: "link track number to album order",
    relation: "track number follows album order",
    disabledReason: "Track number is synced with the album.",
    analyticsProperty: "sync_track_numbers",
    setting: { kind: "trackNumbers" },
  },
  albumArtist: {
    id: "albumArtist",
    label: "link album artist to track artist",
    relation: "album artist follows track artist",
    disabledReason: "Album artist is synced with the album.",
    analyticsProperty: "link_album_artist",
    setting: { kind: "metadataLink", key: "albumArtist" },
    requiresAdvancedMetadata: true,
  },
} as const satisfies Record<MetadataLinkId, MetadataLinkDescriptor>;

export const METADATA_LINK_DESCRIPTORS: readonly MetadataLinkDescriptor[] =
  Object.values(descriptorById);

export const METADATA_LINK_SETTINGS_DESCRIPTORS = METADATA_LINK_DESCRIPTORS.filter(
  (descriptor) => descriptor.id !== "trackNumber",
);

export const getMetadataLinkDescriptor = (id: MetadataLinkId) => descriptorById[id];

export const isMetadataLinkVisible = (
  descriptor: MetadataLinkDescriptor,
  settings: Pick<AppSettings, "advancedMetadata">,
) => !descriptor.requiresAdvancedMetadata || settings.advancedMetadata;

export const isMetadataLinkEnabled = (
  settings: Pick<AppSettings, "metadataLinks" | "syncTrackNumbers">,
  descriptor: MetadataLinkDescriptor,
) =>
  descriptor.setting.kind === "trackNumbers"
    ? settings.syncTrackNumbers
    : settings.metadataLinks[descriptor.setting.key];

export const withMetadataLinkEnabled = (
  settings: AppSettings,
  descriptor: MetadataLinkDescriptor,
  enabled: boolean,
): AppSettings =>
  descriptor.setting.kind === "trackNumbers"
    ? { ...settings, syncTrackNumbers: enabled }
    : {
        ...settings,
        metadataLinks: { ...settings.metadataLinks, [descriptor.setting.key]: enabled },
      };

export const getMetadataLinkState = (
  settings: Pick<AppSettings, "metadataLinks" | "syncTrackNumbers">,
): MetadataLinkState =>
  Object.fromEntries(
    METADATA_LINK_DESCRIPTORS.map((descriptor) => [
      descriptor.id,
      isMetadataLinkEnabled(settings, descriptor),
    ]),
  ) as MetadataLinkState;

export const serializeMetadataLinkAnalytics = (state: MetadataLinkState) =>
  Object.fromEntries(
    METADATA_LINK_DESCRIPTORS.map((descriptor) => [
      descriptor.analyticsProperty,
      state[descriptor.id],
    ]),
  ) as Record<(typeof METADATA_LINK_DESCRIPTORS)[number]["analyticsProperty"], boolean>;
