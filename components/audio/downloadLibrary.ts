import filenamify from "filenamify";
import type { AlbumGroup, TagiumFile } from "./types";
import { isValidFilenameBase } from "./filename";

export interface DownloadZipEntry {
  path: string;
  file: File;
}

export const isTrackReadyForDownload = (file: TagiumFile) =>
  Boolean(file.file && file.metadata && isValidFilenameBase(file.metadata.filename));

export const allTracksReadyForDownload = (files: TagiumFile[]) =>
  files.every(isTrackReadyForDownload);

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

export async function createZipBlob(entries: DownloadZipEntry[]) {
  const { Zip, ZipPassThrough } = await import("fflate");

  return new Promise<Blob>((resolve, reject) => {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let settled = false;
    const settleWithError = (error: unknown) => {
      if (settled) return;
      settled = true;
      archive.terminate();
      reject(error);
    };
    const archive = new Zip((error, chunk, final) => {
      if (error) {
        settleWithError(error);
        return;
      }
      if (chunk.length > 0) chunks.push(Uint8Array.from(chunk));
      if (final && !settled) {
        settled = true;
        resolve(new Blob(chunks, { type: "application/zip" }));
      }
    });

    void (async () => {
      try {
        for (const entry of entries) {
          const zipEntry = new ZipPassThrough(entry.path);
          archive.add(zipEntry);
          const reader = entry.file.stream().getReader();

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                zipEntry.push(new Uint8Array(), true);
                break;
              }
              zipEntry.push(value);
            }
          } finally {
            reader.releaseLock();
          }
        }
        archive.end();
      } catch (error) {
        settleWithError(error);
      }
    })();
  });
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
  if (!track || !isTrackReadyForDownload(track) || !track.file) return;
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
        Boolean(track && isTrackReadyForDownload(track)),
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

    const albumCover = album.cover?.[0];
    if (albumCover) {
      const coverFormat = albumCover.format.split(";")[0]?.trim().toLowerCase();
      let coverFilename = "";
      if (coverFormat === "image/jpeg" || coverFormat === "image/jpg") {
        coverFilename = "cover.jpg";
      }
      if (coverFormat === "image/png") {
        coverFilename = "cover.png";
      }
      if (coverFilename) {
        entries.push({
          path: uniquePath(`${albumFolder}/${coverFilename}`, usedPaths),
          file: new File([albumCover.data], coverFilename, { type: coverFormat }),
        });
      }
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
