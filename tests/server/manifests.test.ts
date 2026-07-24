import { describe, expect, it } from "vite-plus/test";
import artworkHandler from "../../server/api/manifests/[slug]/artwork.get";
import revokeHandler from "../../server/api/manifests/[slug].delete";
import manifestHandler from "../../server/api/manifests/[slug].get";
import publishHandler from "../../server/api/manifests/index.post";
import updateHandler from "../../server/api/manifests/[slug].patch";
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
          if (query.startsWith("UPDATE share_manifests SET\n          version")) {
            const slug = values[8] as string;
            const record = records.get(slug);
            if (
              !record ||
              record.revocationTokenHash !== values[9] ||
              record.status !== "active" ||
              record.expiresAt !== values[10] ||
              record.expiresAt <= Number(values[11]) ||
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
      updateHandler(
        event(
          request(
            `https://tagium.test/api/manifests/${slug}`,
            {
              method: "PATCH",
              headers: { authorization: "Bearer wrong" },
              body: (() => {
                const form = new FormData();
                form.set("manifest", JSON.stringify(manifest));
                return form;
              })(),
            },
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

  it("updates an existing manifest and artwork in place while preserving its URL and expiry", async () => {
    const runtime = createRuntime();
    const createForm = new FormData();
    createForm.set("manifest", JSON.stringify(manifest));
    createForm.set("cover", new File([png], "cover.png"));
    const created = await publishHandler(
      event(
        request(
          "https://tagium.test/api/manifests",
          { method: "POST", body: createForm },
          runtime.env,
        ),
      ),
    );
    const receipt = (await created.json()) as {
      slug: string;
      url: string;
      expiresAt: string;
      revocationToken: string;
    };
    const oldArtworkKey = runtime.records.get(receipt.slug)?.artworkKey;
    const edited = { ...manifest, album: { ...manifest.album, title: "Edited album" } };
    const updateForm = new FormData();
    updateForm.set("manifest", JSON.stringify(edited));
    updateForm.set("cover", new File([png], "replacement.png"));
    const updated = await updateHandler(
      event(
        request(
          `https://tagium.test/api/manifests/${receipt.slug}`,
          {
            method: "PATCH",
            headers: { authorization: `Bearer ${receipt.revocationToken}` },
            body: updateForm,
          },
          runtime.env,
        ),
        receipt.slug,
      ),
    );

    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      slug: receipt.slug,
      url: receipt.url,
      expiresAt: receipt.expiresAt,
    });
    expect(runtime.records.size).toBe(1);
    expect(runtime.records.get(receipt.slug)?.artworkKey).not.toBe(oldArtworkKey);
    expect(oldArtworkKey && runtime.artwork.has(oldArtworkKey)).toBe(false);
    const loaded = await manifestHandler(
      event(
        request(`https://tagium.test/api/manifests/${receipt.slug}`, {}, runtime.env),
        receipt.slug,
      ),
    );
    await expect(loaded.json()).resolves.toMatchObject({
      manifest: { album: { title: "Edited album" } },
    });
  });

  it("supports metadata-only artwork retention and explicit artwork removal", async () => {
    const runtime = createRuntime();
    const createForm = new FormData();
    createForm.set("manifest", JSON.stringify(manifest));
    createForm.set("cover", new File([png], "cover.png"));
    const created = await publishHandler(
      event(
        request(
          "https://tagium.test/api/manifests",
          { method: "POST", body: createForm },
          runtime.env,
        ),
      ),
    );
    const receipt = (await created.json()) as { slug: string; revocationToken: string };
    const retainedKey = runtime.records.get(receipt.slug)?.artworkKey;
    const retainForm = new FormData();
    retainForm.set("manifest", JSON.stringify(manifest));
    expect(
      (
        await updateHandler(
          event(
            request(
              `https://tagium.test/api/manifests/${receipt.slug}`,
              {
                method: "PATCH",
                headers: { authorization: `Bearer ${receipt.revocationToken}` },
                body: retainForm,
              },
              runtime.env,
            ),
            receipt.slug,
          ),
        )
      ).status,
    ).toBe(200);
    expect(runtime.records.get(receipt.slug)?.artworkKey).toBe(retainedKey);

    const removeForm = new FormData();
    removeForm.set("manifest", JSON.stringify(manifest));
    removeForm.set("removeArtwork", "true");
    expect(
      (
        await updateHandler(
          event(
            request(
              `https://tagium.test/api/manifests/${receipt.slug}`,
              {
                method: "PATCH",
                headers: { authorization: `Bearer ${receipt.revocationToken}` },
                body: removeForm,
              },
              runtime.env,
            ),
            receipt.slug,
          ),
        )
      ).status,
    ).toBe(200);
    expect(runtime.records.get(receipt.slug)?.artworkKey).toBeNull();
    expect(retainedKey && runtime.artwork.has(retainedKey)).toBe(false);
  });

  it("rate-limits updates and rejects cross-site or ambiguous update bodies", async () => {
    const runtime = createRuntime();
    runtime.env.SHARE_UPDATE_RATE_LIMITER = { limit: async () => ({ success: false }) };
    const slug = "a".repeat(22);
    const limitedForm = new FormData();
    limitedForm.set("manifest", JSON.stringify(manifest));
    const limited = await updateHandler(
      event(
        request(
          `https://tagium.test/api/manifests/${slug}`,
          {
            method: "PATCH",
            headers: { authorization: "Bearer token" },
            body: limitedForm,
          },
          runtime.env,
        ),
        slug,
      ),
    );
    expect(limited.status).toBe(429);

    delete runtime.env.SHARE_UPDATE_RATE_LIMITER;
    const publishForm = new FormData();
    publishForm.set("manifest", JSON.stringify(manifest));
    const publishResponse = await publishHandler(
      event(
        request(
          "https://tagium.test/api/manifests",
          { method: "POST", body: publishForm, headers: { origin: "https://tagium.test" } },
          runtime.env,
        ),
      ),
    );
    const receipt = (await publishResponse.json()) as { slug: string; revocationToken: string };
    const crossSiteForm = new FormData();
    crossSiteForm.set(
      "manifest",
      JSON.stringify({ ...manifest, album: { ...manifest.album, title: "Cross-site" } }),
    );
    const crossSitePatch = await updateHandler(
      event(
        request(
          `https://tagium.test/api/manifests/${receipt.slug}`,
          {
            method: "PATCH",
            headers: {
              authorization: `Bearer ${receipt.revocationToken}`,
              origin: "https://evil.test",
              "sec-fetch-site": "cross-site",
            },
            body: crossSiteForm,
          },
          runtime.env,
        ),
        receipt.slug,
      ),
    );
    expect(crossSitePatch.status).toBe(400);
    expect(JSON.parse(runtime.records.get(receipt.slug)!.payloadJson).album.title).toBe("Album");

    const invalidForm = new FormData();
    invalidForm.set("manifest", JSON.stringify(manifest));
    invalidForm.set("cover", new File([png], "cover.png"));
    invalidForm.set("removeArtwork", "true");
    const invalid = await updateHandler(
      event(
        request(
          `https://tagium.test/api/manifests/${slug}`,
          {
            method: "PATCH",
            headers: {
              authorization: "Bearer token",
              origin: "https://tagium.test",
            },
            body: invalidForm,
          },
          runtime.env,
        ),
        slug,
      ),
    );
    expect(invalid.status).toBe(400);
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
        duplex: "half",
      } as RequestInit,
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
