import {
  decodeManifest,
  MANIFEST_VERSION,
  manifestSchema,
  shareAnalyticsIdSchema,
  type Manifest,
} from "@/features/share/shareManifest";
import { Option, Schema } from "effect";

const UNAVAILABLE_MESSAGE = "this share is no longer available";
const SHARE_METADATA_TOO_LARGE_MESSAGE = "this share contains too much metadata to publish.";

export class SharedContentUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_MESSAGE);
    this.name = "SharedContentUnavailableError";
  }
}

export class SharedContentVersionError extends Error {
  constructor() {
    super("this link was made by a newer tagium version");
    this.name = "SharedContentVersionError";
  }
}

export interface SharePublicationReceipt {
  slug: string;
  url: string;
  expiresAt: string;
  revocationToken: string;
}

export interface CreatedSharePublicationReceipt extends SharePublicationReceipt {
  analyticsId: string;
}

export type ShareUpdateReceipt = Omit<SharePublicationReceipt, "revocationToken"> & {
  analyticsId: string;
};

const apiPath = (slug: string, suffix = "") =>
  `/api/manifests/${encodeURIComponent(slug)}${suffix}`;

const readJson = async (response: Response) => {
  try {
    return await response.json();
  } catch {
    throw new SharedContentUnavailableError();
  }
};

const manifestVersionProbeSchema = Schema.Struct({
  manifest: Schema.Struct({ version: Schema.Number }),
});
const sharedContentResponseSchema = Schema.Struct({
  manifest: manifestSchema,
  expiresAt: Schema.String,
  analyticsId: shareAnalyticsIdSchema,
});
const createShareReceiptSchema = Schema.Struct({
  slug: Schema.String,
  url: Schema.String,
  expiresAt: Schema.String,
  revocationToken: Schema.String,
  analyticsId: shareAnalyticsIdSchema,
});
const updateShareReceiptSchema = Schema.Struct({
  slug: Schema.String,
  url: Schema.String,
  expiresAt: Schema.String,
  analyticsId: shareAnalyticsIdSchema,
});

export interface FetchedSharedContent {
  manifest: Manifest;
  expiresAt: string;
  analyticsId: string;
}

export const fetchSharedContent = async (
  slug: string,
  dependencies: { fetch?: typeof globalThis.fetch } = {},
): Promise<FetchedSharedContent> => {
  const response = await (dependencies.fetch ?? globalThis.fetch)(apiPath(slug), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new SharedContentUnavailableError();

  try {
    const payload = await readJson(response);
    const versionProbe = Schema.decodeUnknownOption(manifestVersionProbeSchema)(payload);
    if (Option.isSome(versionProbe) && versionProbe.value.manifest.version !== MANIFEST_VERSION) {
      throw new SharedContentVersionError();
    }
    const decoded = Schema.decodeUnknownSync(sharedContentResponseSchema)(payload);
    return {
      manifest: decodeManifest(decoded.manifest),
      expiresAt: decoded.expiresAt,
      analyticsId: decoded.analyticsId,
    };
  } catch (error) {
    if (error instanceof SharedContentVersionError) throw error;
    throw new SharedContentUnavailableError();
  }
};

export const fetchSharedArtwork = async (
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

export const publishShare = async (
  manifest: Manifest,
  cover: File | null,
  dependencies: { fetch?: typeof globalThis.fetch } = {},
): Promise<CreatedSharePublicationReceipt> => {
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
  try {
    return Schema.decodeUnknownSync(createShareReceiptSchema)(await readJson(response));
  } catch {
    throw new Error("the share link could not be created");
  }
};

export const updateShare = async (
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
    throw new Error(`the shared ${manifest.kind} could not be updated`);
  }
  try {
    return Schema.decodeUnknownSync(updateShareReceiptSchema)(await readJson(response));
  } catch {
    throw new Error(`the shared ${manifest.kind} could not be updated`);
  }
};

export const revokeShare = async (
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
