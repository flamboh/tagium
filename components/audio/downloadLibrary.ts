import filenamify from "filenamify";
import type { AlbumGroup, TagiumFile } from "./types";

export interface DownloadZipEntry {
  path: string;
  file: File;
}

export const allTracksReadyForDownload = (files: TagiumFile[]) =>
  files.every((file) => Boolean(file.file && file.metadata));

const padTimePart = (value: number) => String(value).padStart(2, "0");

export const createDownloadTimestamp = (date: Date) =>
  `${date.getFullYear()}${padTimePart(date.getMonth() + 1)}${padTimePart(date.getDate())}-${padTimePart(date.getHours())}${padTimePart(date.getMinutes())}${padTimePart(date.getSeconds())}`;

export const createLibraryDownloadFilename = (date = new Date()) =>
  `tagium-download-${createDownloadTimestamp(date)}.zip`;

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const createZipData = async (entries: Record<string, [Uint8Array, { level: 0 }]>) => {
  const { zip } = await import("fflate");
  return new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    });
  });
};

export async function createZipBlob(entries: DownloadZipEntry[]) {
  const zipEntries: Record<string, [Uint8Array, { level: 0 }]> = {};
  await Promise.all(
    entries.map(async (entry) => {
      zipEntries[entry.path] = [new Uint8Array(await entry.file.arrayBuffer()), { level: 0 }];
    }),
  );
  const data = await createZipData(zipEntries);
  return new Blob([data.buffer as ArrayBuffer], { type: "application/zip" });
}

const cleanPathPart = (value: string, fallback: string) => {
  const cleaned = filenamify(value.trim(), { replacement: "-" });
  if (cleaned) return cleaned;
  return fallback;
};

const uniquePath = (path: string, usedPaths: Set<string>) => {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }

  const lastSlashIndex = path.lastIndexOf("/");
  const folderPath = lastSlashIndex >= 0 ? path.slice(0, lastSlashIndex + 1) : "";
  const filename = lastSlashIndex >= 0 ? path.slice(lastSlashIndex + 1) : path;
  const extensionIndex = filename.lastIndexOf(".");
  const basename = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  const extension = extensionIndex > 0 ? filename.slice(extensionIndex) : "";
  let count = 2;
  let nextPath = `${folderPath}${basename}-${count}${extension}`;

  while (usedPaths.has(nextPath)) {
    count++;
    nextPath = `${folderPath}${basename}-${count}${extension}`;
  }

  usedPaths.add(nextPath);
  return nextPath;
};

const addTrackEntry = (
  entries: DownloadZipEntry[],
  usedPaths: Set<string>,
  folderPath: string,
  track: TagiumFile | undefined,
) => {
  if (!track?.file || !track.metadata) return;
  const filename = cleanPathPart(track.filename, "track.mp3");
  entries.push({
    path: uniquePath(`${folderPath}/${filename}`, usedPaths),
    file: track.file,
  });
};

export function getLibraryDownloadEntries({
  albums,
  looseTrackIds,
  files,
  albumRoot = "albums",
  includeUnassignedFiles = true,
}: {
  albums: AlbumGroup[];
  looseTrackIds: string[];
  files: TagiumFile[];
  albumRoot?: string;
  includeUnassignedFiles?: boolean;
}) {
  const filesById = new Map(files.map((file) => [file.id, file]));
  const includedTrackIds = new Set<string>();
  const usedPaths = new Set<string>();
  const usedFolders = new Set<string>();
  const entries: DownloadZipEntry[] = [];

  for (const album of albums) {
    const albumTracks = album.trackIds
      .map((trackId) => filesById.get(trackId))
      .filter((track): track is TagiumFile & { file: File } =>
        Boolean(track?.file && track.metadata),
      );

    album.trackIds.forEach((trackId) => includedTrackIds.add(trackId));
    if (albumTracks.length === 0) continue;

    const albumFolder = uniquePath(
      `${albumRoot}${albumRoot ? "/" : ""}${cleanPathPart(album.title, "untitled-album")}`,
      usedFolders,
    );

    for (const track of albumTracks) {
      addTrackEntry(entries, usedPaths, albumFolder, track);
    }
  }

  for (const trackId of looseTrackIds) {
    includedTrackIds.add(trackId);
    addTrackEntry(entries, usedPaths, "singles", filesById.get(trackId));
  }

  if (includeUnassignedFiles) {
    for (const file of files) {
      if (includedTrackIds.has(file.id)) continue;
      addTrackEntry(entries, usedPaths, "singles", file);
    }
  }

  return entries;
}
