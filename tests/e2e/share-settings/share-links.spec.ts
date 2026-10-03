import { expect, test } from "./fixtures";
import { albumManifest, createShare, imageBytes } from "./helpers";

const unavailableHeading = "this share is no longer available";

const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const metaContent = (html: string, attribute: "name" | "property", key: string) =>
  html.match(new RegExp(`<meta ${attribute}="${key}" content="([^"]*)" />`, "u"))?.[1];

test("every share path is noindex and dead or malformed links show the unavailable page", async ({
  page,
  request,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({ title: "Live One" });
  const live = await createShare(
    request,
    albumManifest({ title: "Live Album", artist: "Someone", tracks: [{ video }] }),
  );
  const revoked = await createShare(
    request,
    albumManifest({ title: "Gone Album", artist: "Someone", tracks: [{ video }] }),
  );
  expect(
    (
      await request.delete(`/api/manifests/${revoked.slug}`, {
        headers: { Authorization: `Bearer ${revoked.revocationToken}` },
      })
    ).status(),
  ).toBe(204);

  for (const path of [
    `/share/${live.slug}`,
    `/share/${revoked.slug}`,
    "/share/zzzzzz",
    "/share/not-valid",
    "/share/ABCDEF",
    "/share/abcde",
    `/share/${live.slug}/extra`,
    "/share/",
    "/share",
  ]) {
    const response = await request.get(path);
    expect(response.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
  }
  expect((await request.get("/")).headers()["x-robots-tag"]).toBeUndefined();

  for (const slug of ["zzzzzz", revoked.slug]) {
    const response = await request.get(`/api/manifests/${slug}`);
    expect(response.status()).toBe(404);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }

  for (const path of [
    `/share/${revoked.slug}`,
    "/share/zzzzzz",
    "/share/not-valid",
    "/share/ABCDEF",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { level: 1, name: unavailableHeading }),
      path,
    ).toBeVisible();
    await expect(
      page.getByText("the link may have expired, or sharing was stopped."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "add to library" })).not.toBeAttached();
    await expect(page.getByRole("button", { name: "stop sharing" })).not.toBeAttached();
  }
  await page.getByRole("link", { name: "tagium" }).click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("textbox", { name: "media url" })).toBeVisible();
});

test("link previews carry escaped open graph tags and real preview images", async ({
  request,
  upstreams,
}) => {
  const video = await upstreams.youtube.video({ title: "Preview Track" });
  const covered = await createShare(
    request,
    albumManifest({
      title: 'Café & <Night> "Set"',
      artist: "DJ <B>",
      artwork: "image/png",
      tracks: [{ video }, { video, title: "Second" }],
    }),
    "artwork",
  );

  const response = await request.get(`/share/${covered.slug}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const html = await response.text();
  const shareUrl = new URL(`/share/${covered.slug}`, response.url()).href;
  expect(html).toContain("<title>Café &amp; &lt;Night&gt; &quot;Set&quot; · tagium</title>");
  expect(html).not.toContain("<Night>");
  expect(metaContent(html, "name", "description")).toBe(
    "DJ &lt;B&gt; · 2 tracks · shared on tagium",
  );
  expect(metaContent(html, "property", "og:title")).toBe(
    "Café &amp; &lt;Night&gt; &quot;Set&quot; - DJ &lt;B&gt;",
  );
  expect(metaContent(html, "property", "og:type")).toBe("website");
  expect(metaContent(html, "property", "og:url")).toBe(shareUrl);
  expect(metaContent(html, "property", "og:site_name")).toBe("tagium");
  expect(html).toContain(`<link rel="canonical" href="${shareUrl}" />`);
  expect(metaContent(html, "name", "twitter:card")).toBe("summary_large_image");

  const ogImage = metaContent(html, "property", "og:image")!;
  expect(ogImage).toBe(new URL(`/api/manifests/${covered.slug}/preview-artwork`, shareUrl).href);
  const preview = await request.get(ogImage);
  expect(preview.headers()["content-type"]).toBe("image/png");
  expect(new Uint8Array(await preview.body())).toEqual(imageBytes("artwork"));
  const original = await request.get(`/api/manifests/${covered.slug}/artwork`);
  expect(new Uint8Array(await original.body())).toEqual(imageBytes("artwork"));

  const twitterImage = metaContent(html, "name", "twitter:image")!;
  expect(twitterImage).toBe(new URL(`/api/manifests/${covered.slug}/social-card`, shareUrl).href);
  const card = await request.get(twitterImage);
  expect(card.status()).toBe(200);
  expect(card.headers()["content-type"]).toBe("image/png");
  expect(pngSize(new Uint8Array(await card.body()))).toEqual({ width: 1200, height: 630 });

  const plain = await createShare(
    request,
    albumManifest({ title: "No Cover", artist: "", tracks: [{ video }] }),
  );
  const plainHtml = await (await request.get(`/share/${plain.slug}`)).text();
  expect(metaContent(plainHtml, "name", "description")).toBe(
    "unknown artist · 1 track · shared on tagium",
  );
  expect(metaContent(plainHtml, "property", "og:image")).toBe(
    new URL("/icon-512.png", shareUrl).href,
  );
  expect((await request.get(`/api/manifests/${plain.slug}/artwork`)).status()).toBe(404);

  const track = await createShare(request, {
    version: 1,
    kind: "track",
    track: {
      sourceUrl: video.url,
      audioBitrate: "320",
      metadata: { filename: "x", title: "Lone Track", artist: "Solo", album: "", genre: "" },
    },
  });
  const trackHtml = await (await request.get(`/share/${track.slug}`)).text();
  expect(trackHtml).toContain("<title>Lone Track · tagium</title>");
  expect(metaContent(trackHtml, "name", "description")).toBe("Solo · shared track on tagium");

  await request.delete(`/api/manifests/${covered.slug}`, {
    headers: { Authorization: `Bearer ${covered.revocationToken}` },
  });
  expect((await request.get(twitterImage)).status()).toBe(404);
  expect((await request.get(`/api/manifests/${covered.slug}/artwork`)).status()).toBe(404);
  const revokedHtml = await (await request.get(`/share/${covered.slug}`)).text();
  expect(revokedHtml).not.toContain("Night");
});

test("a link made by a newer tagium asks the visitor to reload instead of adding", async ({
  page,
}) => {
  await page.route("**/api/manifests/zzzzzz", (route) =>
    route.fulfill({
      json: {
        manifest: { version: 2, kind: "album" },
        expiresAt: null,
        analyticsId: "a".repeat(43),
      },
    }),
  );
  await page.goto("/share/zzzzzz");
  await expect(
    page.getByRole("heading", { level: 1, name: "this link needs a newer version of tagium" }),
  ).toBeVisible();
  await expect(
    page.getByText("reload the page to update, then open the link again. nothing has been added."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "add to library" })).not.toBeAttached();
});
