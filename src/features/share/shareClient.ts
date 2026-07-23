import { decodeManifest, MANIFEST_VERSION, type Manifest } from "@/features/share/shareManifest";

const UNAVAILABLE_MESSAGE = "this shared album is no longer available";
const SHARE_METADATA_TOO_LARGE_MESSAGE = "this album contains too much metadata to share.";

export class SharedAlbumUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_MESSAGE);
    this.name = "SharedAlbumUnavailableError";
  }
}

export class SharedAlbumVersionError extends Error {
  constructor() {
    super("this link was made by a newer tagium version");
    this.name = "SharedAlbumVersionError";
  }
}

export interface SharePublicationReceipt {
  slug: string;
  url: string;
  expiresAt: string;
  revocationToken: string;
}

export type ShareUpdateReceipt = Omit<SharePublicationReceipt, "revocationToken">;

const apiPath = (slug: string, suffix = "") =>
  `/api/manifests/${encodeURIComponent(slug)}${suffix}`;

const readJson = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    throw new SharedAlbumUnavailableError();
  }
};

export interface FetchedSharedAlbum {
  manifest: Manifest;
  expiresAt: string;
}

export const fetchSharedAlbum = async (
  slug: string,
  dependencies: { fetch?: typeof globalThis.fetch } = {},
): Promise<FetchedSharedAlbum> => {
  const response = await (dependencies.fetch ?? globalThis.fetch)(apiPath(slug), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new SharedAlbumUnavailableError();

  try {
    const payload = await readJson(response);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("manifest" in payload) ||
      !("expiresAt" in payload) ||
      typeof payload.expiresAt !== "string"
    ) {
      throw new SharedAlbumUnavailableError();
    }
    if (
      typeof payload.manifest === "object" &&
      payload.manifest !== null &&
      "version" in payload.manifest &&
      payload.manifest.version !== MANIFEST_VERSION
    ) {
      throw new SharedAlbumVersionError();
    }
    return {
      manifest: decodeManifest(payload.manifest),
      expiresAt: payload.expiresAt,
    };
  } catch (error) {
    if (error instanceof SharedAlbumVersionError) throw error;
    throw new SharedAlbumUnavailableError();
  }
};

export const fetchSharedAlbumArtwork = async (
  slug: string,
  dependencies: { fetch?: typeof globalThis.fetch } = {},
) => {
  const response = await (dependencies.fetch ?? globalThis.fetch)(apiPath(slug, "/artwork"), {
    headers: { Accept: "image/jpeg,image/png" },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "image/jpeg" && contentType !== "image/png") return null;
  return new File(
    [await response.blob()],
    contentType === "image/png" ? "cover.png" : "cover.jpg",
    {
      type: contentType,
    },
  );
};

export const publishSharedAlbum = async (
  manifest: Manifest,
  cover: File | null,
  dependencies: { fetch?: typeof globalThis.fetch } = {},
): Promise<SharePublicationReceipt> => {
  const body = new FormData();
  body.set("manifest", JSON.stringify(manifest));
  if (cover) body.set("cover", cover);
  const response = await (dependencies.fetch ?? globalThis.fetch)("/api/manifests", {
    method: "POST",
    body,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 413)
      throw new Error(SHARE_METADATA_TOO_LARGE_MESSAGE);
    if (response.status === 429) throw new Error("too many share requests; try again shortly");
    throw new Error("the share link could not be created");
  }
  const receipt = await readJson(response);
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    typeof receipt.slug !== "string" ||
    typeof receipt.url !== "string" ||
    typeof receipt.expiresAt !== "string" ||
    typeof receipt.revocationToken !== "string"
  ) {
    throw new Error("the share link could not be created");
  }
  return receipt as SharePublicationReceipt;
};

export const updateSharedAlbum = async (
  slug: string,
  revocationToken: string,
  manifest: Manifest,
  cover: File | null,
  dependencies: { fetch?: typeof globalThis.fetch } = {},
): Promise<ShareUpdateReceipt> => {
  const body = new FormData();
  body.set("manifest", JSON.stringify(manifest));
  if (cover) body.set("cover", cover);
  else body.set("removeArtwork", "true");
  const response = await (dependencies.fetch ?? globalThis.fetch)(apiPath(slug), {
    method: "PATCH",
    body,
    headers: {
      Authorization: `Bearer ${revocationToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 413)
      throw new Error(SHARE_METADATA_TOO_LARGE_MESSAGE);
    if (response.status === 429) throw new Error("too many update requests; try again shortly");
    throw new Error("the shared album could not be updated");
  }
  const receipt = await readJson(response);
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    typeof receipt.slug !== "string" ||
    typeof receipt.url !== "string" ||
    typeof receipt.expiresAt !== "string"
  ) {
    throw new Error("the shared album could not be updated");
  }
  return receipt as ShareUpdateReceipt;
};

export const revokeSharedAlbum = async (
  slug: string,
  revocationToken: string,
  dependencies: { fetch?: typeof globalThis.fetch } = {},
) => {
  const response = await (dependencies.fetch ?? globalThis.fetch)(apiPath(slug), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${revocationToken}`,
      Accept: "application/json",
    },
  });
  // Only a confirmed revocation permits deleting the local capability.
  if (response.status !== 204) {
    throw new Error("sharing could not be stopped");
  }
};

export const sharedArtworkUrl = (slug: string) => apiPath(slug, "/artwork");
