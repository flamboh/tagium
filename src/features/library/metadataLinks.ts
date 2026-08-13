import type { AppSettings, MetadataLinks } from "@/features/library/types";

export type MetadataLinkId = keyof MetadataLinks | "trackNumber" | "filename";
export type MetadataLinkState = Record<MetadataLinkId, boolean>;

export type MetadataLinkGroup = "fromAlbum" | "fromTrack";

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
    label: "sync artist with the album artist",
    disabledReason: "artist is synced with the album artist.",
    analyticsProperty: "link_artist",
    setting: { kind: "metadataLink", key: "artist" },
    map: { source: "album artist", target: "artist", group: "fromAlbum" },
  },
  year: {
    id: "year",
    label: "sync year with the album year",
    disabledReason: "year is synced with the album year.",
    analyticsProperty: "link_year",
    setting: { kind: "metadataLink", key: "year" },
    map: { source: "album year", target: "year", group: "fromAlbum" },
  },
  genre: {
    id: "genre",
    label: "sync genre with the album genre",
    disabledReason: "genre is synced with the album genre.",
    analyticsProperty: "link_genre",
    setting: { kind: "metadataLink", key: "genre" },
    map: { source: "album genre", target: "genre", group: "fromAlbum" },
  },
  artwork: {
    id: "artwork",
    label: "sync artwork with the album cover",
    disabledReason: "artwork is synced with the album cover.",
    analyticsProperty: "link_artwork",
    setting: { kind: "metadataLink", key: "artwork" },
    map: { source: "album cover", target: "artwork", group: "fromAlbum" },
  },
  trackNumber: {
    id: "trackNumber",
    label: "sync track number with the sidebar order",
    disabledReason: "track number is synced with the sidebar order.",
    analyticsProperty: "sync_track_numbers",
    setting: { kind: "trackNumbers" },
    map: { source: "sidebar order", target: "track number", group: "fromAlbum" },
  },
  filename: {
    id: "filename",
    label: "sync filename with the track title",
    disabledReason: "filename is synced with the track title.",
    analyticsProperty: "sync_filenames",
    setting: { kind: "filenames" },
    map: { source: "track title", target: "filename", group: "fromTrack" },
  },
  singleAlbum: {
    id: "singleAlbum",
    label: "sync album with the track title",
    disabledReason: "album is synced with the track title.",
    analyticsProperty: "link_single_album",
    setting: { kind: "metadataLink", key: "singleAlbum" },
    map: { source: "track title", target: "album", group: "fromTrack" },
  },
  albumArtist: {
    id: "albumArtist",
    label: "sync album artist with the track artist",
    disabledReason: "album artist is synced with the track artist.",
    analyticsProperty: "link_album_artist",
    setting: { kind: "metadataLink", key: "albumArtist" },
    map: { source: "track artist", target: "album artist", group: "fromTrack" },
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
) =>
  ({
    artist: isMetadataLinkEnabled(settings, descriptorById.artist),
    year: isMetadataLinkEnabled(settings, descriptorById.year),
    genre: isMetadataLinkEnabled(settings, descriptorById.genre),
    artwork: isMetadataLinkEnabled(settings, descriptorById.artwork),
    trackNumber: isMetadataLinkEnabled(settings, descriptorById.trackNumber),
    filename: isMetadataLinkEnabled(settings, descriptorById.filename),
    singleAlbum: isMetadataLinkEnabled(settings, descriptorById.singleAlbum),
    albumArtist: isMetadataLinkEnabled(settings, descriptorById.albumArtist),
  }) satisfies MetadataLinkState;

export const serializeMetadataLinkAnalytics = (state: MetadataLinkState) => ({
  link_artist: state.artist,
  link_year: state.year,
  link_genre: state.genre,
  link_artwork: state.artwork,
  sync_track_numbers: state.trackNumber,
  sync_filenames: state.filename,
  link_single_album: state.singleAlbum,
  link_album_artist: state.albumArtist,
});
