import { mockEvent } from "h3";
import type { ShareRuntimeEnv } from "../../server/utils/share-manifest-request";

type ShareRecord = {
  slug: string;
  version: number;
  payloadJson: string;
  artworkKey: string | null;
  artworkType: string | null;
  artworkBytes: number | null;
  artworkSha256: string | null;
  revocationTokenHash: string;
  trackCount: number;
  payloadBytes: number;
  status: "active" | "disabled";
  createdAt: number;
  expiresAt: number | null;
};

export const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7OwAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

export const createRuntime = () => {
  const records = new Map<string, ShareRecord>();
  const artwork = new Map<string, { bytes: Uint8Array; type: string; sha256: string }>();
  const database = {
    prepare: (query: string) => {
      let values: unknown[] = [];
      const statement = {
        bind: (...next: unknown[]) => {
          values = next;
          return statement;
        },
        run: async () => {
          if (query.startsWith("UPDATE share_manifests SET\n          version")) {
            const slug = values[8] as string;
            const record = records.get(slug);
            if (
              !record ||
              record.revocationTokenHash !== values[9] ||
              record.status !== "active" ||
              record.expiresAt !== values[10] ||
              (record.expiresAt !== null && record.expiresAt <= Number(values[11])) ||
              record.payloadJson !== values[12] ||
              record.artworkKey !== values[13]
            )
              return { meta: { changes: 0 } };
            Object.assign(record, {
              version: values[0],
              payloadJson: values[1],
              artworkKey: values[2],
              artworkType: values[3],
              artworkBytes: values[4],
              artworkSha256: values[5],
              trackCount: values[6],
              payloadBytes: values[7],
            });
            return { meta: { changes: 1 } };
          }
          const record = Object.fromEntries(
            [
              "slug",
              "version",
              "payloadJson",
              "artworkKey",
              "artworkType",
              "artworkBytes",
              "artworkSha256",
              "revocationTokenHash",
              "trackCount",
              "payloadBytes",
              "status",
              "createdAt",
              "expiresAt",
            ].map((key, index) => [key, values[index]]),
          ) as ShareRecord;
          records.set(record.slug, record);
          return { meta: { changes: 1 } };
        },
        first: async <T>() => {
          const slug = values[0] as string;
          const record = records.get(slug);
          if (query.startsWith("UPDATE")) {
            if (
              !record ||
              record.revocationTokenHash !== values[1] ||
              (record.expiresAt !== null && record.expiresAt <= Number(values[2]))
            )
              return null;
            record.status = "disabled";
          }
          return (record ?? null) as T | null;
        },
      };
      return statement;
    },
  };
  const bucket = {
    put: async (
      key: string,
      bytes: Uint8Array,
      options: { httpMetadata: { contentType: string }; customMetadata: { sha256: string } },
    ) => {
      artwork.set(key, {
        bytes,
        type: options.httpMetadata.contentType,
        sha256: options.customMetadata.sha256,
      });
    },
    get: async (key: string) => {
      const object = artwork.get(key);
      return object
        ? {
            body: new Blob([Uint8Array.from(object.bytes).buffer]).stream(),
            httpMetadata: { contentType: object.type },
            size: object.bytes.byteLength,
            etag: object.sha256,
          }
        : null;
    },
    delete: async (key: string) => {
      artwork.delete(key);
    },
  };
  return {
    records,
    artwork,
    bucket,
    env: { SHARE_MANIFESTS: database, SHARE_ARTWORK: bucket } as ShareRuntimeEnv,
  };
};

export const event = (request: Request, slug?: string) =>
  Object.assign(mockEvent(request), { context: { params: slug === undefined ? {} : { slug } } });

export const request = (
  url: string,
  init: RequestInit,
  runtime: ReturnType<typeof createRuntime>["env"],
) => {
  const value = new Request(url, init) as Request & {
    runtime: { cloudflare: { env: typeof runtime } };
  };
  value.runtime = { cloudflare: { env: runtime } };
  return value;
};
