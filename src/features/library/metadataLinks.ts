import type { AppSettings, MetadataLinks } from "@/features/library/types";

export type MetadataLinkId = keyof MetadataLinks | "trackNumber" | "filename";
export type MetadataLinkState = Record<MetadataLinkId, boolean>;

export type MetadataLinkGroup = "albumToTrack" | "followsTrack";

export interface MetadataLinkDescriptor {
  id: MetadataLinkId;
  label: string;
  disabledReason: string;
  analyticsProperty:
    | "link_artist"
    | "link_year"
    | "link_genre"
    | "link_artwork"
    | "link_single_album"
    | "sync_track_numbers"
    | "sync_filenames"
    | "link_album_artist";
  setting:
    | { kind: "metadataLink"; key: keyof MetadataLinks }
    | { kind: "trackNumbers" }
    | { kind: "filenames" };
  map: {
    source: string;
    target: string;
    group: MetadataLinkGroup;
  };
  requiresAdvancedMetadata?: true;
}

const descriptorById = {
  artist: {
    id: "artist",
    label: "artist follows the album artist",
    disabledReason: "artist follows the album artist.",
    analyticsProperty: "link_artist",
    setting: { kind: "metadataLink", key: "artist" },
    map: { source: "album artist", target: "artist", group: "albumToTrack" },
  },
  year: {
    id: "year",
    label: "year follows the album year",
    disabledReason: "year follows the album year.",
    analyticsProperty: "link_year",
    setting: { kind: "metadataLink", key: "year" },
    map: { source: "album year", target: "year", group: "albumToTrack" },
  },
  genre: {
    id: "genre",
    label: "genre follows the album genre",
    disabledReason: "genre follows the album genre.",
    analyticsProperty: "link_genre",
    setting: { kind: "metadataLink", key: "genre" },
    map: { source: "album genre", target: "genre", group: "albumToTrack" },
  },
  artwork: {
    id: "artwork",
    label: "artwork follows the album cover",
    disabledReason: "artwork follows the album cover.",
    analyticsProperty: "link_artwork",
    setting: { kind: "metadataLink", key: "artwork" },
    map: { source: "album cover", target: "artwork", group: "albumToTrack" },
  },
  trackNumber: {
    id: "trackNumber",
    label: "track number follows the sidebar order",
    disabledReason: "track number follows the sidebar order.",
    analyticsProperty: "sync_track_numbers",
    setting: { kind: "trackNumbers" },
    map: { source: "sidebar order", target: "track number", group: "albumToTrack" },
  },
  filename: {
    id: "filename",
    label: "filename follows the track title",
    disabledReason: "filename follows the track title.",
    analyticsProperty: "sync_filenames",
    setting: { kind: "filenames" },
    map: { source: "track title", target: "filename", group: "followsTrack" },
  },
  singleAlbum: {
    id: "singleAlbum",
    label: "album title follows the track title",
    disabledReason: "album title follows the track title.",
    analyticsProperty: "link_single_album",
    setting: { kind: "metadataLink", key: "singleAlbum" },
    map: { source: "track title", target: "album title", group: "followsTrack" },
  },
  albumArtist: {
    id: "albumArtist",
    label: "album artist tag follows the track artist",
    disabledReason: "album artist tag follows the track artist.",
    analyticsProperty: "link_album_artist",
    setting: { kind: "metadataLink", key: "albumArtist" },
    map: { source: "track artist", target: "album artist tag", group: "followsTrack" },
    requiresAdvancedMetadata: true,
  },
} as const satisfies Record<MetadataLinkId, MetadataLinkDescriptor>;

export const METADATA_LINK_DESCRIPTORS: readonly MetadataLinkDescriptor[] =
  Object.values(descriptorById);

export const getMetadataLinkDescriptor = (id: MetadataLinkId) => descriptorById[id];

export const isMetadataLinkVisible = (
  descriptor: MetadataLinkDescriptor,
  settings: Pick<AppSettings, "advancedMetadata">,
) => !descriptor.requiresAdvancedMetadata || settings.advancedMetadata;

export const isMetadataLinkEnabled = (
  settings: Pick<AppSettings, "metadataLinks" | "syncTrackNumbers" | "syncFilenames">,
  descriptor: MetadataLinkDescriptor,
) => {
  switch (descriptor.setting.kind) {
    case "metadataLink":
      return settings.metadataLinks[descriptor.setting.key];
    case "trackNumbers":
      return settings.syncTrackNumbers;
    case "filenames":
      return settings.syncFilenames;
  }
};

export const withMetadataLinkEnabled = (
  settings: AppSettings,
  descriptor: MetadataLinkDescriptor,
  enabled: boolean,
): AppSettings => {
  switch (descriptor.setting.kind) {
    case "metadataLink":
      return {
        ...settings,
        metadataLinks: { ...settings.metadataLinks, [descriptor.setting.key]: enabled },
      };
    case "trackNumbers":
      return { ...settings, syncTrackNumbers: enabled };
    case "filenames":
      return { ...settings, syncFilenames: enabled };
  }
};

export const getMetadataLinkState = (
  settings: Pick<AppSettings, "metadataLinks" | "syncTrackNumbers" | "syncFilenames">,
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
