import { describe, expect, it } from "vite-plus/test";
import {
  createShareManifestStore,
  parseShareArtwork,
  SHARE_MANIFEST_LIFETIME_MS,
  type ShareManifestPersistence,
  type StoredShareManifest,
} from "../../../server/utils/share-manifest";
import artworkLifecycle from "../../../scripts/share-artwork-lifecycle.json";

const manifest = {
  version: 1 as const,
  kind: "album" as const,
  album: { title: "Album", artist: "Artist", genre: "Genre" },
  tracks: [
    {
      sourceUrl: "https://youtu.be/dQw4w9WgXcQ",
      audioBitrate: "320" as const,
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

const createFakePersistence = () => {
  const records = new Map<string, StoredShareManifest>();
  const artwork = new Map<string, Uint8Array>();
  const persistence: ShareManifestPersistence = {
    putArtwork: async ({ key, bytes }) => {
      artwork.set(key, bytes);
    },
    deleteArtwork: async (key) => {
      artwork.delete(key);
    },
    getArtwork: async (key) => {
      const bytes = artwork.get(key);
      return bytes
        ? {
            body: new Blob([Uint8Array.from(bytes).buffer]).stream(),
            type: "image/png",
            size: bytes.byteLength,
          }
        : undefined;
    },
    create: async (record) => {
      if (records.has(record.slug)) return "conflict";
      records.set(record.slug, record);
      return "created";
    },
    get: async (slug) => records.get(slug),
    update: async ({ previous, replacement, revocationTokenHash, now }) => {
      const current = records.get(previous.slug);
      if (
        !current ||
        current.status !== "active" ||
        (current.expiresAt !== null && current.expiresAt <= now) ||
        current.expiresAt !== previous.expiresAt ||
        current.payloadJson !== previous.payloadJson ||
        current.artworkKey !== previous.artworkKey ||
        current.revocationTokenHash !== revocationTokenHash
      )
        return "conflict";
      records.set(previous.slug, replacement);
      return "updated";
    },
    disable: async (slug, tokenHash, now) => {
      const record = records.get(slug);
      if (
        !record ||
        (record.expiresAt !== null && record.expiresAt <= now) ||
        record.revocationTokenHash !== tokenHash
      )
        return undefined;
      const disabled = { ...record, status: "disabled" as const };
      records.set(slug, disabled);
      return disabled;
    },
  };
  return { persistence, records, artwork };
};

describe("share manifest store", () => {
  it("publishes a single record and makes it unavailable at exactly 90 days", async () => {
    const fake = createFakePersistence();
    let now = 1_000;
    const store = createShareManifestStore(fake.persistence, { now: () => now });
    const published = await store.publish(manifest, undefined);

    expect(published.expiresAt).toBe(1_000 + SHARE_MANIFEST_LIFETIME_MS);
    expect(published.analyticsId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(published.analyticsId).not.toBe(published.slug);
    expect(await store.load(published.slug)).toMatchObject({
      kind: "available",
      expiresAt: published.expiresAt,
      analyticsId: published.analyticsId,
    });
    now = published.expiresAt!;
    expect(await store.load(published.slug)).toEqual({ kind: "unavailable" });
  });

  it("publishes indefinite records without an expiry and keeps their artwork out of the lifecycle prefix", async () => {
    const fake = createFakePersistence();
    let now = 1_000;
    const store = createShareManifestStore(fake.persistence, { now: () => now });
    const artwork = (await parseShareArtwork(new File([png], "cover.png")))!;
    const published = await store.publish(manifest, artwork, { indefinite: true });
    const record = fake.records.get(published.slug)!;

    expect(published.expiresAt).toBeNull();
    expect(record.expiresAt).toBeNull();
    expect(record.artworkKey).toMatch(
      new RegExp(`^permanent-shares/${published.slug}/[^/]+\\.png$`),
    );
    for (const rule of artworkLifecycle.rules)
      expect(record.artworkKey!.startsWith(rule.conditions.prefix)).toBe(false);
    now = 1_000 + 10 * SHARE_MANIFEST_LIFETIME_MS;
    expect(await store.load(published.slug)).toMatchObject({ kind: "available", expiresAt: null });
    await expect(store.loadArtwork(published.slug)).resolves.toMatchObject({ kind: "available" });

    await expect(
      store.update(
        published.slug,
        published.revocationToken,
        { ...manifest, album: { ...manifest.album, title: "Edited" } },
        { kind: "replace", artwork },
      ),
    ).resolves.toEqual({
      kind: "updated",
      slug: published.slug,
      expiresAt: null,
      analyticsId: published.analyticsId,
    });
    const updated = fake.records.get(published.slug)!;
    expect(updated.expiresAt).toBeNull();
    expect(updated.artworkKey).not.toBe(record.artworkKey);
    expect(updated.artworkKey).toMatch(/^permanent-shares\//);
    expect([...fake.artwork.keys()]).toEqual([updated.artworkKey]);

    await expect(store.revoke(published.slug, published.revocationToken)).resolves.toBe("revoked");
    expect(fake.artwork.size).toBe(0);
    expect(await store.load(published.slug)).toEqual({ kind: "unavailable" });
  });

  it("never lets a forced slug collision overwrite an existing cover", async () => {
    const fake = createFakePersistence();
    const keys: string[] = [];
    const originalPut = fake.persistence.putArtwork;
    fake.persistence.putArtwork = async (input) => {
      keys.push(input.key);
      await originalPut(input);
    };
    let calls = 0;
    fake.persistence.create = async (record) => {
      calls += 1;
      if (calls === 1) return "conflict";
      fake.records.set(record.slug, record);
      return "created";
    };
    const tokens = ["revocation", "first-owner", "second-owner"];
    const slugs = ["aaaaaa", "bbbbbb"];
    const store = createShareManifestStore(fake.persistence, {
      randomToken: () => tokens.shift()!,
      randomSlug: () => slugs.shift()!,
    });
    await store.publish(manifest, await parseShareArtwork(new File([png], "cover.png")));

    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    expect(fake.artwork.has(keys[0]!)).toBe(false);
    expect(fake.artwork.has(keys[1]!)).toBe(true);
  });

  it("reports an R2 failure after disabling, so a retry can complete deletion", async () => {
    const fake = createFakePersistence();
    let failDelete = true;
    fake.persistence.deleteArtwork = async (key) => {
      if (failDelete) throw new Error("R2 unavailable");
      fake.artwork.delete(key);
    };
    const store = createShareManifestStore(fake.persistence);
    const published = await store.publish(
      manifest,
      await parseShareArtwork(new File([png], "cover.png")),
    );

    await expect(store.revoke(published.slug, published.revocationToken)).resolves.toBe(
      "artwork_unavailable",
    );
    expect(fake.records.get(published.slug)?.status).toBe("disabled");
    failDelete = false;
    await expect(store.revoke(published.slug, published.revocationToken)).resolves.toBe("revoked");
  });

  it("compensates an uploaded cover when D1 creation fails", async () => {
    const fake = createFakePersistence();
    fake.persistence.create = async () => {
      throw new Error("D1 unavailable");
    };
    const store = createShareManifestStore(fake.persistence);
    const cover = new File([png], "cover.png");

    await expect(store.publish(manifest, await parseShareArtwork(cover))).rejects.toThrow(
      "D1 unavailable",
    );
    expect(fake.artwork.size).toBe(0);
  });

  it("cleans an artwork object when put stores it before rejecting", async () => {
    const fake = createFakePersistence();
    const originalPut = fake.persistence.putArtwork;
    fake.persistence.putArtwork = async (input) => {
      await originalPut(input);
      throw new Error("R2 unavailable");
    };
    const store = createShareManifestStore(fake.persistence);
    await expect(
      store.publish(manifest, await parseShareArtwork(new File([png], "cover.png"))),
    ).rejects.toThrow("R2 unavailable");
    expect(fake.artwork.size).toBe(0);
  });

  it("replaces and removes artwork without leaving superseded objects", async () => {
    const fake = createFakePersistence();
    const store = createShareManifestStore(fake.persistence);
    const artwork = await parseShareArtwork(new File([png], "cover.png"));
    const published = await store.publish(manifest, artwork);
    const originalKey = fake.records.get(published.slug)?.artworkKey;

    await expect(
      store.update(published.slug, published.revocationToken, manifest, {
        kind: "replace",
        artwork: artwork!,
      }),
    ).resolves.toMatchObject({ kind: "updated", slug: published.slug });
    const replacementKey = fake.records.get(published.slug)?.artworkKey;
    expect(replacementKey).not.toBe(originalKey);
    expect(originalKey && fake.artwork.has(originalKey)).toBe(false);
    expect(replacementKey && fake.artwork.has(replacementKey)).toBe(true);

    await expect(
      store.update(published.slug, published.revocationToken, manifest, { kind: "remove" }),
    ).resolves.toMatchObject({ kind: "updated", slug: published.slug });
    expect(replacementKey && fake.artwork.has(replacementKey)).toBe(false);
    expect(fake.records.get(published.slug)?.artworkKey).toBeUndefined();
    expect(await store.loadArtwork(published.slug)).toEqual({ kind: "unavailable" });
  });

  it("compensates a losing artwork update and accepts an already-applied retry", async () => {
    const fake = createFakePersistence();
    const store = createShareManifestStore(fake.persistence);
    const published = await store.publish(manifest, undefined);
    const artwork = (await parseShareArtwork(new File([png], "cover.png")))!;
    const originalUpdate = fake.persistence.update;
    let first = true;
    fake.persistence.update = async (input) => {
      if (!first) return originalUpdate(input);
      first = false;
      fake.records.set(input.previous.slug, {
        ...input.replacement,
        artworkKey: "shares/already-applied.png",
      });
      fake.artwork.set("shares/already-applied.png", artwork.bytes);
      return "conflict";
    };

    await expect(
      store.update(published.slug, published.revocationToken, manifest, {
        kind: "replace",
        artwork,
      }),
    ).resolves.toMatchObject({ kind: "updated", slug: published.slug });
    expect(fake.artwork.size).toBe(1);
    expect(fake.artwork.has("shares/already-applied.png")).toBe(true);
  });

  it("compensates failed updates and does not roll back a commit when old artwork cleanup fails", async () => {
    const failed = createFakePersistence();
    const failedStore = createShareManifestStore(failed.persistence);
    const failedPublish = await failedStore.publish(manifest, undefined);
    const artwork = (await parseShareArtwork(new File([png], "cover.png")))!;
    failed.persistence.update = async () => {
      throw new Error("D1 unavailable");
    };
    await expect(
      failedStore.update(failedPublish.slug, failedPublish.revocationToken, manifest, {
        kind: "replace",
        artwork,
      }),
    ).rejects.toThrow("D1 unavailable");
    expect(failed.artwork.size).toBe(0);

    const committed = createFakePersistence();
    const committedStore = createShareManifestStore(committed.persistence);
    const committedPublish = await committedStore.publish(manifest, artwork);
    const oldKey = committed.records.get(committedPublish.slug)?.artworkKey;
    committed.persistence.deleteArtwork = async () => {
      throw new Error("R2 unavailable");
    };
    await expect(
      committedStore.update(committedPublish.slug, committedPublish.revocationToken, manifest, {
        kind: "remove",
      }),
    ).resolves.toMatchObject({ kind: "updated", slug: committedPublish.slug });
    expect(committed.records.get(committedPublish.slug)?.artworkKey).toBeUndefined();
    expect(oldKey && committed.artwork.has(oldKey)).toBe(true);
  });

  it("reconciles an update that commits before D1 reports a failure", async () => {
    const fake = createFakePersistence();
    const store = createShareManifestStore(fake.persistence);
    const published = await store.publish(manifest, undefined);
    const artwork = (await parseShareArtwork(new File([png], "cover.png")))!;
    const originalUpdate = fake.persistence.update;
    fake.persistence.update = async (input) => {
      await originalUpdate(input);
      throw new Error("D1 ambiguous");
    };
    await expect(
      store.update(published.slug, published.revocationToken, manifest, {
        kind: "replace",
        artwork,
      }),
    ).resolves.toMatchObject({ kind: "updated" });
    const currentKey = fake.records.get(published.slug)?.artworkKey;
    expect(currentKey && fake.artwork.has(currentKey)).toBe(true);
  });

  it("preserves a candidate when ambiguous-update verification fails", async () => {
    const fake = createFakePersistence();
    const store = createShareManifestStore(fake.persistence);
    const published = await store.publish(manifest, undefined);
    const artwork = (await parseShareArtwork(new File([png], "cover.png")))!;
    fake.persistence.update = async () => {
      throw new Error("D1 ambiguous");
    };
    const originalGet = fake.persistence.get;
    let reads = 0;
    fake.persistence.get = async (slug) => {
      reads += 1;
      if (reads > 1) throw new Error("D1 unavailable");
      return originalGet(slug);
    };
    await expect(
      store.update(published.slug, published.revocationToken, manifest, {
        kind: "replace",
        artwork,
      }),
    ).rejects.toThrow("D1 ambiguous");
    expect(fake.artwork.size).toBe(1);
  });

  it("does not delete a candidate referenced by the live row after a CAS conflict", async () => {
    const fake = createFakePersistence();
    const store = createShareManifestStore(fake.persistence);
    const published = await store.publish(manifest, undefined);
    const artwork = (await parseShareArtwork(new File([png], "cover.png")))!;
    fake.persistence.update = async (input) => {
      fake.records.set(input.previous.slug, input.replacement);
      return "conflict";
    };
    await expect(
      store.update(published.slug, published.revocationToken, manifest, {
        kind: "replace",
        artwork,
      }),
    ).resolves.toMatchObject({ kind: "updated" });
    const currentKey = fake.records.get(published.slug)?.artworkKey;
    expect(currentKey && fake.artwork.has(currentKey)).toBe(true);
  });
});
