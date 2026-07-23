import type { LibraryState } from "@/features/library/libraryState";
import type { AppSettings, TagiumFile } from "@/features/library/types";
import { isTrackReadyForDownload } from "@/features/export/downloadLibrary";

const byteFormatter = new Intl.NumberFormat("en-US");
const compactByteFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export type ConfirmedExportTarget = { kind: "library" } | { kind: "album"; albumId: string };

export interface ExportConfirmationTrack {
  id: string;
  title: string;
  sizeBytes: number;
}

export interface ExportConfirmationGroup {
  id: string;
  title: string;
  tracks: ExportConfirmationTrack[];
  sizeBytes: number;
}

export interface ExportConfirmationSummary {
  target: ConfirmedExportTarget;
  groups: ExportConfirmationGroup[];
  trackCount: number;
  totalSizeBytes: number;
  fingerprint: string;
}

const readyTrack = (track: TagiumFile | undefined): track is TagiumFile & { file: File } =>
  Boolean(track?.file && isTrackReadyForDownload(track));

const summarizeTrack = (track: TagiumFile & { file: File }): ExportConfirmationTrack => ({
  id: track.id,
  title: track.metadata?.title.trim() || track.filename,
  sizeBytes: track.file.size,
});

const summarizeGroup = (
  id: string,
  title: string,
  tracks: Array<TagiumFile & { file: File }>,
): ExportConfirmationGroup => {
  const summarizedTracks = tracks.map(summarizeTrack);
  return {
    id,
    title,
    tracks: summarizedTracks,
    sizeBytes: summarizedTracks.reduce((total, track) => total + track.sizeBytes, 0),
  };
};

export const deriveExportConfirmationSummary = (
  state: LibraryState,
  target: ConfirmedExportTarget,
  settings: AppSettings,
): ExportConfirmationSummary | null => {
  const filesById = new Map(state.files.map((file) => [file.id, file]));
  const groups: ExportConfirmationGroup[] = [];
  const includedTrackIds = new Set<string>();

  const albums =
    target.kind === "album"
      ? state.albums.filter((album) => album.id === target.albumId)
      : state.albums;
  if (target.kind === "album" && albums.length !== 1) return null;

  for (const album of albums) {
    if (target.kind === "library" && album.trackIds.length === 0) continue;
    const tracks = album.trackIds.map((id) => filesById.get(id));
    if (tracks.length === 0 || !tracks.every(readyTrack)) return null;
    album.trackIds.forEach((id) => includedTrackIds.add(id));
    groups.push(summarizeGroup(`album:${album.id}`, album.title, tracks));
  }

  if (target.kind === "library") {
    const looseIds: string[] = [];
    const seenLooseIds = new Set<string>();
    for (const id of state.looseTrackIds) {
      if (!includedTrackIds.has(id) && !seenLooseIds.has(id)) {
        seenLooseIds.add(id);
        looseIds.push(id);
      }
    }
    for (const { id } of state.files) {
      if (!includedTrackIds.has(id) && !seenLooseIds.has(id)) {
        seenLooseIds.add(id);
        looseIds.push(id);
      }
    }
    const looseTracks = looseIds.map((id) => filesById.get(id));
    if (!looseTracks.every(readyTrack)) return null;
    if (looseTracks.length > 0) groups.push(summarizeGroup("loose", "Loose tracks", looseTracks));
  }

  const trackCount = groups.reduce((total, group) => total + group.tracks.length, 0);
  if (trackCount === 0) return null;
  return {
    target,
    groups,
    trackCount,
    totalSizeBytes: groups.reduce((total, group) => total + group.sizeBytes, 0),
    fingerprint: createExportPlanFingerprint(state, target, settings),
  };
};

export const exportConfirmationSummariesMatch = (
  left: ExportConfirmationSummary,
  right: ExportConfirmationSummary,
) => JSON.stringify(left) === JSON.stringify(right);

const binaryFingerprints = new WeakMap<Uint8Array, { identity: number; signature: string }>();
let nextBinaryIdentity = 1;

const hashBinarySample = (bytes: Uint8Array) => {
  let hash = 2_166_136_261;
  const hashByte = (value: number) => {
    hash ^= value;
    hash = Math.imul(hash, 16_777_619);
  };
  const edgeLength = Math.min(64, bytes.length);
  for (let index = 0; index < edgeLength; index++) hashByte(bytes[index] ?? 0);
  for (let index = Math.max(edgeLength, bytes.length - edgeLength); index < bytes.length; index++) {
    hashByte(bytes[index] ?? 0);
  }
  const interiorSamples = Math.min(64, Math.max(0, bytes.length - edgeLength * 2));
  for (let sample = 1; sample <= interiorSamples; sample++) {
    const index = Math.floor((sample * bytes.length) / (interiorSamples + 1));
    hashByte(bytes[index] ?? 0);
  }
  return hash.toString(16).padStart(8, "0");
};

const getBinaryFingerprint = (bytes: Uint8Array) => {
  const cached = binaryFingerprints.get(bytes);
  if (cached) return cached;
  const fingerprint = {
    identity: nextBinaryIdentity++,
    signature: `${bytes.byteLength}:${hashBinarySample(bytes)}`,
  };
  binaryFingerprints.set(bytes, fingerprint);
  return fingerprint;
};

const normalizeFingerprintValue = (value: unknown): unknown => {
  if (value instanceof Uint8Array) return getBinaryFingerprint(value);
  if (Array.isArray(value)) return value.map(normalizeFingerprintValue);
  if (value && typeof value === "object") {
    const normalizedEntries: [string, unknown][] = [];
    for (const [key, entry] of Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      normalizedEntries.push([key, normalizeFingerprintValue(entry)]);
    }
    return Object.fromEntries(normalizedEntries);
  }
  return value;
};

const fileFingerprint = (file: TagiumFile) => ({
  id: file.id,
  filename: file.filename,
  status: file.status,
  downloadStatus: file.downloadStatus,
  downloadRequest: file.downloadRequest,
  pendingMetadataPatch: file.pendingMetadataPatch,
  metadata: file.metadata,
  file: file.file
    ? {
        name: file.file.name,
        size: file.file.size,
        type: file.file.type,
        lastModified: file.file.lastModified,
      }
    : null,
});

export const createExportPlanFingerprint = (
  state: LibraryState,
  target: ConfirmedExportTarget,
  settings: AppSettings,
) => {
  const albumIds =
    target.kind === "album" ? new Set([target.albumId]) : new Set(state.albums.map(({ id }) => id));
  const albums = state.albums.filter(({ id }) => albumIds.has(id));
  const trackIds =
    target.kind === "album"
      ? new Set(albums.flatMap((album) => album.trackIds))
      : new Set(state.files.map(({ id }) => id));
  const files: ReturnType<typeof fileFingerprint>[] = [];
  for (const file of state.files) {
    if (trackIds.has(file.id)) files.push(fileFingerprint(file));
  }
  return JSON.stringify(
    normalizeFingerprintValue({
      target,
      settings,
      albums,
      looseTrackIds: target.kind === "library" ? state.looseTrackIds : [],
      files,
    }),
  );
};

export const formatByteSize = (sizeBytes: number) => {
  const exact = `${byteFormatter.format(sizeBytes)} ${sizeBytes === 1 ? "byte" : "bytes"}`;
  if (sizeBytes < 1_000) return exact;
  const units = ["kB", "MB", "GB", "TB"];
  let value = sizeBytes / 1_000;
  let unit = units[0];
  for (let index = 1; value >= 1_000 && index < units.length; index++) {
    value /= 1_000;
    unit = units[index];
  }
  return `${compactByteFormatter.format(value)} ${unit} (${exact})`;
};
