import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import handler from "../server/api/youtube-cover.get";

const makeEvent = (coverUrl: string) => {
  const request = new Request(
    `https://tagium.test/api/youtube-cover?url=${encodeURIComponent(coverUrl)}`,
  );
  return { req: request } as unknown as Parameters<typeof handler>[0];
};

describe("youtube cover endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("proxies a bounded YouTube JPEG for browser cover imports", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(Uint8Array.of(0xff, 0xd8, 0xff), {
          headers: { "content-type": "image/jpeg", "content-length": "3" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(
      makeEvent("https://i.ytimg.com/pl_c/playlist/studio_square_thumbnail.jpg?sig=test"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.of(0xff, 0xd8, 0xff));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://i.ytimg.com/pl_c/playlist/studio_square_thumbnail.jpg?sig=test",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    "http://i.ytimg.com/cover.jpg",
    "https://example.com/cover.jpg",
    "https://i.ytimg.com.evil.test/cover.jpg",
  ])("rejects non-YouTube image URLs: %s", async (coverUrl) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler(makeEvent(coverUrl));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects non-image upstream responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { headers: { "content-type": "text/html" } })),
    );

    const response = await handler(makeEvent("https://i.ytimg.com/cover.jpg"));

    expect(response.status).toBe(502);
  });
});
