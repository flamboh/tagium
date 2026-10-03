import { defineHandler } from "nitro";
import { Schema } from "effect";
import {
  isShareManifestValidationError,
  parseShareArtwork,
  SHARE_ARTWORK_MAX_BYTES,
  ShareManifestValidationError,
} from "../../utils/share-manifest";
import {
  admitShareCreate,
  badRequest,
  getShareStore,
  infrastructureFailure,
  isSameOriginBrowserRequest,
  noStore,
  publicationCreated,
  readRequestBodyWithinLimit,
} from "../../utils/share-manifest-request";
import { getSoundCloudLogContext } from "../../utils/soundcloud-observability";
import { resolveSoundCloudSet } from "../../utils/soundcloud-set";
import { resolveYouTubePlaylist } from "../../utils/youtube-playlist";
import type { Playlist } from "../../../src/features/import/playlist";
import { projectPlaylistAlbumManifest } from "../../../src/features/share/playlistAlbumManifest";
import { parseMediaLink } from "../../../src/lib/media-link";

const MAX_SHARE_REQUEST_BYTES = SHARE_ARTWORK_MAX_BYTES + 64 * 1024;
const FIELDS = new Set(["source", "album", "cover", "lifetime"]);

const albumOverrideSchema = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  artist: Schema.optionalKey(Schema.String),
  genre: Schema.optionalKey(Schema.String),
  year: Schema.optionalKey(Schema.Number),
});
const decodeAlbumOverride = Schema.decodeUnknownSync(albumOverrideSchema, {
  onExcessProperty: "error",
});

const invalid = (reason: string, cause?: unknown) =>
  new ShareManifestValidationError(reason, { cause });

const parseAlbumOverride = (raw: string | undefined) => {
  if (raw === undefined) return {};
  try {
    return decodeAlbumOverride(JSON.parse(raw));
  } catch (cause) {
    throw invalid("share_album_invalid", cause);
  }
};

const resolvePlaylist = async (
  request: Request,
  provider: "youtube" | "soundcloud",
  sourceUrl: string,
): Promise<Playlist> => {
  try {
    return provider === "youtube"
      ? await resolveYouTubePlaylist(sourceUrl, request.signal)
      : await resolveSoundCloudSet(sourceUrl, getSoundCloudLogContext(request, sourceUrl));
  } catch (cause) {
    throw invalid("share_source_unresolvable", cause);
  }
};

const projectManifest = (playlist: Playlist) => {
  try {
    return projectPlaylistAlbumManifest(playlist);
  } catch (cause) {
    throw invalid("share_manifest_invalid", cause);
  }
};

export default defineHandler(async (event) => {
  const request = event.req;
  if (!(await admitShareCreate(request)))
    return new Response(null, { status: 429, headers: noStore });
  if (!isSameOriginBrowserRequest(request)) return badRequest();
  const store = getShareStore(request);
  if (!store) return infrastructureFailure();
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) return badRequest();

  try {
    const body = await readRequestBodyWithinLimit(request, MAX_SHARE_REQUEST_BYTES);
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    }).formData();
    if ([...form.keys()].some((name) => !FIELDS.has(name))) return badRequest();
    const sources = form.getAll("source");
    const albums = form.getAll("album");
    const covers = form.getAll("cover");
    const lifetimes = form.getAll("lifetime");
    const isString = Schema.is(Schema.String);
    if (
      sources.length !== 1 ||
      albums.length > 1 ||
      covers.length > 1 ||
      lifetimes.length > 1 ||
      (lifetimes[0] !== undefined && lifetimes[0] !== "indefinite") ||
      !isString(sources[0]) ||
      (albums[0] !== undefined && !isString(albums[0])) ||
      (covers[0] !== undefined && !(covers[0] instanceof File))
    )
      return badRequest();
    const source = parseMediaLink(sources[0]);
    if (source.kind !== "playlist") return badRequest();
    const album = parseAlbumOverride(albums[0]);
    const artwork = await parseShareArtwork(covers[0] instanceof File ? covers[0] : undefined);
    const playlist = await resolvePlaylist(request, source.provider, source.canonicalUrl);
    const manifest = projectManifest({ ...playlist, ...album, sourceUrl: source.canonicalUrl });
    return publicationCreated(
      request,
      await store.publish(manifest, artwork, { indefinite: lifetimes[0] === "indefinite" }),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (isShareManifestValidationError(error) ||
        error instanceof TypeError ||
        error.message === "share_request_too_large")
    )
      return badRequest();
    return infrastructureFailure();
  }
});
