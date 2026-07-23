import { sanitizeFilenameBase } from "@/features/library/filename";
import { audioFilename, getAudioFormat } from "@/features/audio/audioFormat";
import type { AlbumGroup, MetadataPatch, TagiumFile } from "@/features/library/types";

const removableLabels = [
  "official audio",
  "audio",
  "visualizer",
  "official video",
  "lyrics",
] as const;
const artistSeparators = [" - ", " – ", " — ", ": "] as const;

export interface MetadataCleanupSuggestion {
  trackId: string;
  beforeTitle: string;
  afterTitle: string;
  beforeFilename: string;
  afterFilename: string;
  reasons: ("artist" | "album" | "label" | "spacing")[];
}

export interface MetadataCleanupUndoEntry {
  trackId: string;
  title: string;
  filename: string;
  metadataFilename: string;
  status: TagiumFile["status"];
  pendingTitle: { present: boolean; value?: string };
  pendingFilename: { present: boolean; value?: string };
}

const hasOwn = <Key extends PropertyKey>(object: object, key: Key) =>
  Object.prototype.hasOwnProperty.call(object, key);

const normalizeComparable = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();

const removeMatchingArtistPrefix = (title: string, artists: string[]) => {
  const comparableTitle = normalizeComparable(title);
  let matchingArtist: string | undefined;
  for (const artist of artists) {
    const trimmedArtist = artist.trim();
    if (
      trimmedArtist &&
      artistSeparators.some((separator) =>
        comparableTitle.startsWith(`${normalizeComparable(trimmedArtist)}${separator}`),
      )
    ) {
      matchingArtist = trimmedArtist;
      break;
    }
  }
  if (!matchingArtist) return title;

  const separator = artistSeparators.find((candidate) =>
    comparableTitle.startsWith(`${normalizeComparable(matchingArtist)}${candidate}`),
  );
  if (!separator) return title;

  const normalizedPrefix = `${normalizeComparable(matchingArtist)}${separator}`;
  const normalizedTitle = title.normalize("NFKC").trim().replace(/\s+/g, " ");
  return normalizedTitle.slice(normalizedPrefix.length).trim();
};

const removeTrailingNoise = (title: string, albumTitle?: string) => {
  let nextTitle = title.trim();
  let removedAlbum = false;
  let removedLabel = false;
  const comparableAlbum = albumTitle ? normalizeComparable(albumTitle) : "";

  while (true) {
    const annotation = nextTitle.match(/\(([^()]*)\)\s*$/) ?? nextTitle.match(/\[([^\]]*)\]\s*$/);
    const annotationValue = annotation?.[1];
    const annotationRemainder = annotation ? nextTitle.slice(0, annotation.index).trim() : "";

    if (
      annotationValue !== undefined &&
      annotationRemainder &&
      comparableAlbum &&
      normalizeComparable(annotationValue) === comparableAlbum
    ) {
      nextTitle = annotationRemainder;
      removedAlbum = true;
      continue;
    }
    if (
      annotation &&
      annotationValue !== undefined &&
      annotationRemainder &&
      removableLabels.includes(normalizeComparable(annotationValue) as never)
    ) {
      nextTitle = annotationRemainder;
      removedLabel = true;
      continue;
    }

    let albumRemainder = "";
    if (comparableAlbum) {
      for (const separator of nextTitle.matchAll(/\s+[-–—]\s+/g)) {
        const suffix = nextTitle.slice(separator.index + separator[0].length);
        if (normalizeComparable(suffix) === comparableAlbum) {
          albumRemainder = nextTitle.slice(0, separator.index).trim();
          break;
        }
      }
    }
    if (!albumRemainder) break;
    nextTitle = albumRemainder;
    removedAlbum = true;
  }

  return { title: nextTitle, removedAlbum, removedLabel };
};

export function suggestTitleCleanup(
  title: string,
  artists: string[],
  albumTitle?: string,
): Pick<MetadataCleanupSuggestion, "afterTitle" | "reasons"> | null {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) return null;

  const reasons: MetadataCleanupSuggestion["reasons"] = [];
  let nextTitle = removeMatchingArtistPrefix(trimmedTitle, artists);
  if (nextTitle !== trimmedTitle) reasons.push("artist");

  const withoutNoise = removeTrailingNoise(nextTitle, albumTitle);
  if (withoutNoise.removedAlbum) reasons.push("album");
  if (withoutNoise.removedLabel) reasons.push("label");
  nextTitle = withoutNoise.title;

  const normalizedSpacing = nextTitle.replace(/\s+/g, " ").trim();
  if (normalizedSpacing !== nextTitle) reasons.push("spacing");
  nextTitle = normalizedSpacing;

  if (!nextTitle || nextTitle === title || reasons.length === 0) return null;
  return { afterTitle: nextTitle, reasons };
}

export function findMetadataCleanupSuggestions(
  files: TagiumFile[],
  albums: AlbumGroup[],
  candidateTrackIds?: ReadonlySet<string>,
): MetadataCleanupSuggestion[] {
  return files.flatMap((file) => {
    if (candidateTrackIds && !candidateTrackIds.has(file.id)) return [];
    if (!file.metadata) return [];

    const album = albums.find((candidate) => candidate.trackIds.includes(file.id));
    const cleanup = suggestTitleCleanup(
      file.metadata.title,
      [file.metadata.artist, album?.artist ?? ""],
      album?.title,
    );
    if (!cleanup) return [];

    return [
      {
        trackId: file.id,
        beforeTitle: file.metadata.title,
        afterTitle: cleanup.afterTitle,
        beforeFilename: file.filename,
        afterFilename: audioFilename(
          sanitizeFilenameBase(cleanup.afterTitle),
          getAudioFormat(file),
        ),
        reasons: cleanup.reasons,
      },
    ];
  });
}

export function applyMetadataCleanupSuggestions(
  files: TagiumFile[],
  suggestions: MetadataCleanupSuggestion[],
  syncFilenames: boolean,
): { files: TagiumFile[]; undoEntries: MetadataCleanupUndoEntry[] } {
  const suggestionsById = new Map(
    suggestions.map((suggestion) => [suggestion.trackId, suggestion]),
  );
  const undoEntries: MetadataCleanupUndoEntry[] = [];

  const nextFiles = files.map((file) => {
    const suggestion = suggestionsById.get(file.id);
    if (!suggestion || !file.metadata) return file;

    undoEntries.push({
      trackId: file.id,
      title: file.metadata.title,
      filename: file.filename,
      metadataFilename: file.metadata.filename,
      status: file.status,
      pendingTitle: {
        present: hasOwn(file.pendingMetadataPatch ?? {}, "title"),
        value: file.pendingMetadataPatch?.title,
      },
      pendingFilename: {
        present: hasOwn(file.pendingMetadataPatch ?? {}, "filename"),
        value: file.pendingMetadataPatch?.filename,
      },
    });

    const pendingMetadataPatch: MetadataPatch = {
      ...file.pendingMetadataPatch,
      title: suggestion.afterTitle,
      ...(syncFilenames ? { filename: sanitizeFilenameBase(suggestion.afterTitle) } : {}),
    };

    return {
      ...file,
      status: file.status === "saved" ? "pending" : file.status,
      filename: syncFilenames ? suggestion.afterFilename : file.filename,
      metadata: {
        ...file.metadata,
        title: suggestion.afterTitle,
        ...(syncFilenames ? { filename: sanitizeFilenameBase(suggestion.afterTitle) } : {}),
      },
      pendingMetadataPatch,
      hasBufferedChanges: true,
    };
  });

  return { files: nextFiles, undoEntries };
}

const restorePatchField = (
  patch: MetadataPatch,
  field: "title" | "filename",
  snapshot: { present: boolean; value?: string },
) => {
  if (snapshot.present) return { ...patch, [field]: snapshot.value };
  const nextPatch = { ...patch };
  delete nextPatch[field];
  return nextPatch;
};

export function undoMetadataCleanupSuggestions(
  files: TagiumFile[],
  entries: MetadataCleanupUndoEntry[],
): TagiumFile[] {
  const entriesById = new Map(entries.map((entry) => [entry.trackId, entry]));
  return files.map((file) => {
    const entry = entriesById.get(file.id);
    if (!entry || !file.metadata) return file;

    let pendingMetadataPatch = restorePatchField(
      file.pendingMetadataPatch ?? {},
      "title",
      entry.pendingTitle,
    );
    pendingMetadataPatch = restorePatchField(
      pendingMetadataPatch,
      "filename",
      entry.pendingFilename,
    );
    const hasPendingMetadata = Object.keys(pendingMetadataPatch).length > 0;

    return {
      ...file,
      status: !hasPendingMetadata && file.status === "pending" ? entry.status : file.status,
      filename: entry.filename,
      metadata: { ...file.metadata, title: entry.title, filename: entry.metadataFilename },
      pendingMetadataPatch: hasPendingMetadata ? pendingMetadataPatch : undefined,
      hasBufferedChanges: hasPendingMetadata,
    };
  });
}
