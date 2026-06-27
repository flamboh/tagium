import type { AlbumGroup, TagiumFile } from "./types";

export type LibraryTreeEntry =
  | {
      type: "album";
      albumId: string;
      path: string;
      trackIds: string[];
    }
  | {
      type: "track";
      albumId: string | null;
      path: string;
      trackId: string;
    };

interface BuildLibraryTreeInput {
  albums: AlbumGroup[];
  files: TagiumFile[];
  looseTrackIds: string[];
}

export interface LibraryTreeModel {
  entriesByPath: Map<string, LibraryTreeEntry>;
  pathByAlbumId: Map<string, string>;
  pathByTrackId: Map<string, string>;
  paths: string[];
  signature: string;
}

const sanitizePathSegment = (value: string, fallback: string) => {
  const segment = value.replaceAll("/", ":").replace(/\s+/g, " ").trim();
  if (segment.length > 0) return segment;
  return fallback;
};

const uniqueSegment = (baseSegment: string, seenSegments: Set<string>) => {
  let segment = baseSegment;
  let index = 2;
  while (seenSegments.has(segment.toLowerCase())) {
    segment = `${baseSegment} (${index})`;
    index += 1;
  }
  seenSegments.add(segment.toLowerCase());
  return segment;
};

const trackSegment = (track: TagiumFile, index?: number) => {
  const filename = sanitizePathSegment(track.filename, "untitled track.mp3");
  if (index === undefined) return filename;
  return `${index + 1}. ${filename}`;
};

export function buildLibraryTree({
  albums,
  files,
  looseTrackIds,
}: BuildLibraryTreeInput): LibraryTreeModel {
  const filesById = new Map(files.map((file) => [file.id, file]));
  const entriesByPath = new Map<string, LibraryTreeEntry>();
  const pathByAlbumId = new Map<string, string>();
  const pathByTrackId = new Map<string, string>();
  const paths: string[] = [];
  const rootSegments = new Set<string>();

  for (const album of albums) {
    const albumSegment = uniqueSegment(
      sanitizePathSegment(album.title, "untitled album"),
      rootSegments,
    );
    const albumPath = `${albumSegment}/`;
    paths.push(albumPath);
    pathByAlbumId.set(album.id, albumPath);
    entriesByPath.set(albumPath, {
      type: "album",
      albumId: album.id,
      path: albumPath,
      trackIds: album.trackIds,
    });

    const albumTrackSegments = new Set<string>();
    album.trackIds.forEach((trackId, index) => {
      const track = filesById.get(trackId);
      if (!track) return;

      const path = `${albumPath}${uniqueSegment(trackSegment(track, index), albumTrackSegments)}`;
      paths.push(path);
      entriesByPath.set(path, {
        type: "track",
        albumId: album.id,
        path,
        trackId,
      });
      pathByTrackId.set(trackId, path);
    });
  }

  const looseTracks = looseTrackIds
    .map((trackId) => filesById.get(trackId))
    .filter((track): track is TagiumFile => Boolean(track));

  for (const track of looseTracks) {
    const path = uniqueSegment(trackSegment(track), rootSegments);
    paths.push(path);
    entriesByPath.set(path, {
      type: "track",
      albumId: null,
      path,
      trackId: track.id,
    });
    pathByTrackId.set(track.id, path);
  }

  return {
    entriesByPath,
    pathByAlbumId,
    pathByTrackId,
    paths,
    signature: paths.join("\n"),
  };
}
