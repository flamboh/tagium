import { describe, expect, it } from "vite-plus/test";
import artworkHandler from "../../server/api/manifests/[slug]/artwork.get";
import revokeHandler from "../../server/api/manifests/[slug].delete";
import manifestHandler from "../../server/api/manifests/[slug].get";
import publishHandler from "../../server/api/manifests/index.post";
import noindexMiddleware from "../../server/middleware/02-share-noindex";
import type { ShareRuntimeEnv } from "../../server/utils/share-manifest-request";
import { isShareExpiryIso } from "../../src/features/share/shareManifest";

type Record = {
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
  expiresAt: number;
};

const manifest = {
  version: 1,
  kind: "album",
  album: { title: "Album", artist: "Artist", genre: "Genre" },
  tracks: [
    {
      sourceUrl: "https://youtu.be/dQw4w9WgXcQ",
      audioBitrate: "320",
      metadata: {
        filename: "track",
        title: "Track",
        artist: "Artist",
        album: "Album",
        genre: "Genre",
      },
    },
  ],
};

const png = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7OwAAAABJRU5ErkJggg==",
  ),
  (character) => character.charCodeAt(0),
);

const createRuntime = () => {
  const records = new Map<string, Record>();
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
          ) as Record;
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
              record.expiresAt <= Number(values[2])
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
            body: new Blob([object.bytes]).stream(),
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
    env: { SHARE_MANIFESTS: database, SHARE_ARTWORK: bucket } as ShareRuntimeEnv,
  };
};

const event = (request: Request, slug?: string) =>
  ({ req: request, context: { params: { slug } } }) as unknown as Parameters<
    typeof publishHandler
  >[0];

const request = (
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

describe("share manifest endpoints", () => {
  it("publishes ISO expiry envelopes that the client can consume, serves artwork, then revokes idempotently", async () => {
    const runtime = createRuntime();
    const form = new FormData();
    form.set("manifest", JSON.stringify(manifest));
    form.set("cover", new File([png], "cover.png", { type: "image/png" }));
    const published = await publishHandler(
      event(
        request("https://tagium.test/api/manifests", { method: "POST", body: form }, runtime.env),
      ),
    );

    expect(published.status).toBe(201);
    expect(published.headers.get("cache-control")).toBe("no-store");
    const receipt = (await published.json()) as {
      slug: string;
      revocationToken: string;
      expiresAt: string;
    };
    expect(isShareExpiryIso(receipt.expiresAt)).toBe(true);

    const loaded = await manifestHandler(
      event(
        request(`https://tagium.test/api/manifests/${receipt.slug}`, {}, runtime.env),
        receipt.slug,
      ),
    );
    expect(loaded.status).toBe(200);
    expect(loaded.headers.get("cache-control")).toBe("no-store");
    const payload = (await loaded.clone().json()) as { expiresAt: string };
    expect(isShareExpiryIso(payload.expiresAt)).toBe(true);
    await expect(loaded.json()).resolves.toMatchObject({ manifest });

    const cover = await artworkHandler(
      event(
        request(`https://tagium.test/api/manifests/${receipt.slug}/artwork`, {}, runtime.env),
        receipt.slug,
      ),
    );
    expect(cover.status).toBe(200);
    expect(cover.headers.get("cache-control")).toBe("no-store");
    expect(cover.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await cover.arrayBuffer())).toEqual(png);

    const revoked = await revokeHandler(
      event(
        request(
          `https://tagium.test/api/manifests/${receipt.slug}`,
          { method: "DELETE", headers: { authorization: `Bearer ${receipt.revocationToken}` } },
          runtime.env,
        ),
        receipt.slug,
      ),
    );
    expect(revoked.status).toBe(204);
    expect(revoked.headers.get("cache-control")).toBe("no-store");
    const retry = await revokeHandler(
      event(
        request(
          `https://tagium.test/api/manifests/${receipt.slug}`,
          { method: "DELETE", headers: { authorization: `Bearer ${receipt.revocationToken}` } },
          runtime.env,
        ),
        receipt.slug,
      ),
    );
    expect(retry.status).toBe(204);
    expect(runtime.artwork.size).toBe(0);

    const unavailable = await manifestHandler(
      event(
        request(`https://tagium.test/api/manifests/${receipt.slug}`, {}, runtime.env),
        receipt.slug,
      ),
    );
    expect(unavailable.status).toBe(404);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
  });

  it("uses one unavailable response for missing manifests, artwork, and invalid revocation", async () => {
    const runtime = createRuntime();
    const slug = "a".repeat(22);
    for (const response of await Promise.all([
      manifestHandler(
        event(request(`https://tagium.test/api/manifests/${slug}`, {}, runtime.env), slug),
      ),
      artworkHandler(
        event(request(`https://tagium.test/api/manifests/${slug}/artwork`, {}, runtime.env), slug),
      ),
      revokeHandler(
        event(
          request(
            `https://tagium.test/api/manifests/${slug}`,
            { method: "DELETE", headers: { authorization: "Bearer wrong" } },
            runtime.env,
          ),
          slug,
        ),
      ),
    ])) {
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("rejects rate-limited create and read requests without exposing stored state", async () => {
    const runtime = createRuntime();
    runtime.env.SHARE_CREATE_RATE_LIMITER = { limit: async () => ({ success: false }) };
    runtime.env.SHARE_READ_RATE_LIMITER = { limit: async () => ({ success: false }) };
    const form = new FormData();
    form.set("manifest", JSON.stringify(manifest));
    const create = await publishHandler(
      event(
        request("https://tagium.test/api/manifests", { method: "POST", body: form }, runtime.env),
      ),
    );
    const read = await manifestHandler(
      event(
        request(`https://tagium.test/api/manifests/${"a".repeat(22)}`, {}, runtime.env),
        "a".repeat(22),
      ),
    );
    expect(create.status).toBe(429);
    expect(read.status).toBe(429);
    expect(create.headers.get("cache-control")).toBe("no-store");
    expect(read.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects cross-site, duplicate and unexpected multipart fields before persistence", async () => {
    const runtime = createRuntime();
    const crossSite = new FormData();
    crossSite.set("manifest", JSON.stringify(manifest));
    const crossSiteResponse = await publishHandler(
      event(
        request(
          "https://tagium.test/api/manifests",
          {
            method: "POST",
            body: crossSite,
            headers: { origin: "https://evil.test", "sec-fetch-site": "cross-site" },
          },
          runtime.env,
        ),
      ),
    );
    expect(crossSiteResponse.status).toBe(400);

    const duplicate = new FormData();
    duplicate.append("manifest", JSON.stringify(manifest));
    duplicate.append("manifest", JSON.stringify(manifest));
    const duplicateResponse = await publishHandler(
      event(
        request(
          "https://tagium.test/api/manifests",
          { method: "POST", body: duplicate },
          runtime.env,
        ),
      ),
    );
    expect(duplicateResponse.status).toBe(400);

    const unexpected = new FormData();
    unexpected.set("manifest", JSON.stringify(manifest));
    unexpected.set("surprise", "nope");
    const unexpectedResponse = await publishHandler(
      event(
        request(
          "https://tagium.test/api/manifests",
          { method: "POST", body: unexpected },
          runtime.env,
        ),
      ),
    );
    expect(unexpectedResponse.status).toBe(400);
    expect(runtime.records.size).toBe(0);
  });

  it("enforces a streamed ceiling without content-length and limits revocation before token hashing", async () => {
    const runtime = createRuntime();
    const oversized = new Uint8Array(6 * 1024 * 1024 + 1);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(oversized);
        controller.close();
      },
    });
    const requestWithStream = request(
      "https://tagium.test/api/manifests",
      {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=test" },
        body,
        duplex: "half" as never,
      },
      runtime.env,
    );
    const response = await publishHandler(event(requestWithStream));
    expect(response.status).toBe(400);

    runtime.env.SHARE_REVOKE_RATE_LIMITER = { limit: async () => ({ success: false }) };
    const limited = await revokeHandler(
      event(
        request(
          `https://tagium.test/api/manifests/${"a".repeat(22)}`,
          { method: "DELETE", headers: { authorization: `Bearer ${"x".repeat(10_000)}` } },
          runtime.env,
        ),
        "a".repeat(22),
      ),
    );
    expect(limited.status).toBe(429);
  });

  it("marks shared-album routes as noindex without affecting other routes", () => {
    const headers = new Headers();
    noindexMiddleware({
      req: new Request(`https://tagium.test/share/${"a".repeat(22)}`),
      res: { headers },
    } as Parameters<typeof noindexMiddleware>[0]);
    expect(headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const otherHeaders = new Headers();
    noindexMiddleware({
      req: new Request("https://tagium.test/share/not-a-slug"),
      res: { headers: otherHeaders },
    } as Parameters<typeof noindexMiddleware>[0]);
    expect(otherHeaders.get("x-robots-tag")).toBeNull();
  });
});
