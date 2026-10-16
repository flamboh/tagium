import { describe, expect, it, vi } from "vite-plus/test";
import { resolveSoundCloudShortLink } from "../../../server/utils/soundcloud-link";

const shortLink = "https://on.soundcloud.com/abc123";

const resolveWith = (status: number) =>
  resolveSoundCloudShortLink(shortLink, {
    fetch: vi.fn(async () => new Response(null, { status })),
  }).catch((cause: unknown) => cause);

describe("soundcloud short link resolution", () => {
  it.each([404, 410])("treats a %i short link as dead", async (status) => {
    expect(await resolveWith(status)).toMatchObject({ message: "soundcloud.short.unavailable" });
  });

  it.each([429, 500, 503])("keeps a %i lookup retryable", async (status) => {
    expect(await resolveWith(status)).toMatchObject({
      message: "soundcloud.short_link_upstream_failed",
    });
  });
});
