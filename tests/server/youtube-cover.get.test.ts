import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { mockEvent } from "h3";
import handler from "../../server/api/youtube-cover.get";

const makeEvent = (coverUrl: string) => {
  const request = new Request(
    `https://tagium.test/api/youtube-cover?url=${encodeURIComponent(coverUrl)}`,
  );
  return mockEvent(request);
};

describe("youtube cover endpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
