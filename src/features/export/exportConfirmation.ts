import {
  getAlbumCoverDownload,
  getLibraryDownloadEntries,
  isTrackReadyForDownload,
} from "@/features/export/downloadLibrary";
import type { LibraryState } from "@/features/library/libraryState";
import type { AlbumGroup, AppSettings, TagiumFile } from "@/features/library/types";

export type ExportTarget = { kind: "library" } | { kind: "album"; albumId: string };

export interface ExportPlanTrack {
  id: string;
  title: string;
}

export interface ExportPlanGroup {
  id: string;
  title: string;
  tracks: ExportPlanTrack[];
}

export interface ExportPlan {
  target: ExportTarget;
  groups: ExportPlanGroup[];
  trackCount: number;
  totalSizeBytes: number;
}

type RelevantExportSettings = Pick<AppSettings, "syncFilenames" | "syncTrackNumbers">;

const planFingerprints = new WeakMap<ExportPlan, string>();
const fileIdentities = new WeakMap<File, number>();
let nextFileIdentity = 1;

const fileIdentity = (file: File) => {
  const existing = fileIdentities.get(file);
  if (existing !== undefined) return existing;
  const identity = nextFileIdentity++;
  fileIdentities.set(file, identity);
  return identity;
};

const hashArtworkBytes = (bytes: Uint8Array) => {
  let firstHash = 2_166_136_261;
  let secondHash = 5381;
  for (const byte of bytes) {
    firstHash ^= byte;
    firstHash = Math.imul(firstHash, 16_777_619);
    secondHash = Math.imul(secondHash, 33) ^ byte;
  }
  return `${bytes.byteLength}:${(firstHash >>> 0).toString(16).padStart(8, "0")}:${(secondHash >>> 0).toString(16).padStart(8, "0")}`;
};

const normalizeFingerprintValue = (
  value: unknown,
  artworkFingerprints: WeakMap<Uint8Array, string>,
): unknown => {
  if (value instanceof Uint8Array) {
    const cached = artworkFingerprints.get(value);
    if (cached) return cached;
    const fingerprint = hashArtworkBytes(value);
    artworkFingerprints.set(value, fingerprint);
    return fingerprint;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeFingerprintValue(entry, artworkFingerprints));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeFingerprintValue(entry, artworkFingerprints)]),
    );
  }
  return value;
};

const indexFilesById = (files: TagiumFile[]) => {
  const filesById = new Map<string, TagiumFile>();
  for (const file of files) filesById.set(file.id, file);
  return filesById;
};

const planTrack = (track: TagiumFile): ExportPlanTrack => ({
  id: track.id,
  title: track.metadata?.title.trim() || track.filename,
});

const appendAlbumGroup = ({
  album,
  filesById,
  includedTrackIds,
  groups,
}: {
  album: AlbumGroup;
  filesById: Map<string, TagiumFile>;
  includedTrackIds: Set<string>;
  groups: ExportPlanGroup[];
}) => {
  const tracks: TagiumFile[] = [];
  for (const trackId of album.trackIds) {
    if (includedTrackIds.has(trackId)) continue;
    const track = filesById.get(trackId);
    if (!track || !isTrackReadyForDownload(track)) return false;
    includedTrackIds.add(trackId);
    tracks.push(track);
  }
  if (tracks.length === 0) return true;
  groups.push({
    id: `album:${album.id}`,
    title: album.title,
    tracks: tracks.map(planTrack),
  });
  return true;
};

export const planExport = (
  state: LibraryState,
  target: ExportTarget,
  settings: RelevantExportSettings,
): ExportPlan | null => {
  const filesById = indexFilesById(state.files);
  const includedTrackIds = new Set<string>();
  const groups: ExportPlanGroup[] = [];
  const targetAlbums =
    target.kind === "album"
      ? state.albums.filter((album) => album.id === target.albumId)
      : state.albums;
  if (target.kind === "album" && targetAlbums.length !== 1) return null;

  for (const album of targetAlbums) {
    if (
      !appendAlbumGroup({
        album,
        filesById,
        includedTrackIds,
        groups,
      })
    ) {
      return null;
    }
  }

  if (target.kind === "album" && groups.length === 0) return null;

  if (target.kind === "library") {
    const looseTracks: TagiumFile[] = [];
    const appendLooseTrack = (trackId: string) => {
      if (includedTrackIds.has(trackId)) return true;
      const track = filesById.get(trackId);
      if (!track || !isTrackReadyForDownload(track)) return false;
      includedTrackIds.add(trackId);
      looseTracks.push(track);
      return true;
    };
    for (const trackId of state.looseTrackIds) {
      if (!appendLooseTrack(trackId)) return null;
    }
    for (const file of state.files) {
      if (!appendLooseTrack(file.id)) return null;
    }
    if (looseTracks.length > 0) {
      groups.push({
        id: "loose",
        title: "singles",
        tracks: looseTracks.map(planTrack),
      });
    }
  }

  const trackIds = groups.flatMap((group) => group.tracks.map((track) => track.id));
  if (trackIds.length === 0) return null;

  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const albums: AlbumGroup[] = [];
  for (const album of targetAlbums) {
    const group = groupsById.get(`album:${album.id}`);
    if (!group) continue;
    albums.push({
      ...album,
      trackIds: group.tracks.map(({ id }) => id),
    });
  }
  const looseTrackIds =
    groups.find((group) => group.id === "loose")?.tracks.map(({ id }) => id) ?? [];
  const files = trackIds
    .map((id) => filesById.get(id))
    .filter((file): file is TagiumFile => !!file);
  const entries = getLibraryDownloadEntries({
    albums,
    looseTrackIds,
    files,
    albumRoot: target.kind === "album" ? "" : "albums",
    includeUnassignedFiles: false,
  });
  const plan: ExportPlan = {
    target,
    groups,
    trackCount: trackIds.length,
    totalSizeBytes: files.reduce((total, file) => total + (file.file?.size ?? 0), 0),
  };

  const artworkFingerprints = new WeakMap<Uint8Array, string>();
  const albumFingerprint = albums.map((album) => ({
    id: album.id,
    title: album.title,
    artist: album.artist,
    genre: album.genre,
    year: album.year,
    trackIds: album.trackIds,
    cover: getAlbumCoverDownload(album),
  }));
  const fileFingerprint = files.map((file) => ({
    id: file.id,
    filename: file.filename,
    format: file.format,
    metadata: file.metadata,
    pendingMetadataPatch: file.pendingMetadataPatch,
    ready: isTrackReadyForDownload(file),
    file: file.file
      ? {
          identity: fileIdentity(file.file),
          name: file.file.name,
          size: file.file.size,
          type: file.file.type,
          lastModified: file.file.lastModified,
        }
      : null,
  }));
  const fingerprint = JSON.stringify(
    normalizeFingerprintValue(
      {
        target,
        settings: {
          syncFilenames: settings.syncFilenames,
          syncTrackNumbers: settings.syncTrackNumbers,
        },
        groups,
        albums: albumFingerprint,
        files: fileFingerprint,
        entries: entries.map((entry) => ({ path: entry.path, size: entry.file.size })),
      },
      artworkFingerprints,
    ),
  );
  planFingerprints.set(plan, fingerprint);
  return plan;
};

export const samePlan = (left: ExportPlan, right: ExportPlan) =>
  left === right ||
  (planFingerprints.has(left) &&
    planFingerprints.has(right) &&
    planFingerprints.get(left) === planFingerprints.get(right));

const fractionalMegabyteFormatter = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  maximumFractionDigits: 1,
});
const wholeMegabyteFormatter = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  maximumFractionDigits: 0,
});
const smallMegabyteFormatter = new Intl.NumberFormat("en-US", {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const largeMegabyteFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 2,
});

export const formatMegabyteSize = (sizeBytes: number) => {
  const megabytes = sizeBytes / 1_000_000;
  const formatted =
    megabytes < 0.1
      ? smallMegabyteFormatter.format(megabytes)
      : megabytes >= 999.5
        ? largeMegabyteFormatter.format(megabytes)
        : megabytes < 100
          ? fractionalMegabyteFormatter.format(megabytes)
          : wholeMegabyteFormatter.format(megabytes);
  return `${formatted.toLowerCase()} mb`;
};
