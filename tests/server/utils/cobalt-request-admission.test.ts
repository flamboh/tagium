import { describe, expect, it, vi } from "vite-plus/test";
import {
  createCloudflareCobaltRequestAdmission,
  createInMemoryCobaltRequestAdmission,
  type CloudflareRateLimitBinding,
} from "../../../server/utils/cobalt-request-admission";

const binding = (success: boolean): CloudflareRateLimitBinding => ({
  limit: vi.fn(async () => ({ success })),
});

const request = (headers: Record<string, string> = {}) =>
  new Request("https://tagium.test/api/cobalt/audio", { headers });

describe("cobaltRequestAdmission", () => {
  it("uses the anonymous session and Cloudflare client keys", async () => {
    const sessionLimiter = binding(true);
    const clientLimiter = binding(true);
    const admission = createCloudflareCobaltRequestAdmission({ sessionLimiter, clientLimiter });

    await expect(
      admission.admit(
        request({
          Cookie: "tagium_client_id=session-1",
          "CF-Connecting-IP": "203.0.113.10",
        }),
      ),
    ).resolves.toEqual({ status: "allowed", setCookie: undefined });
    expect(sessionLimiter.limit).toHaveBeenCalledWith({ key: "session-1" });
    expect(clientLimiter.limit).toHaveBeenCalledWith({ key: "203.0.113.10" });
  });

  it("issues an HttpOnly session cookie when one is missing", async () => {
    const admission = createCloudflareCobaltRequestAdmission({
      sessionLimiter: binding(true),
      clientLimiter: binding(true),
    });

    const decision = await admission.admit(request({ "CF-Connecting-IP": "203.0.113.10" }));

    expect(decision).toMatchObject({ status: "allowed" });
    expect(decision.setCookie).toMatch(
      /^tagium_client_id=[\w-]+; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/,
    );
  });

  it("gives the coarse client backstop precedence", async () => {
    const admission = createCloudflareCobaltRequestAdmission({
      sessionLimiter: binding(false),
      clientLimiter: binding(false),
    });

    await expect(admission.admit(request())).resolves.toMatchObject({
      status: "limited",
      scope: "client",
    });
  });

  it("fails closed when a binding is unavailable", async () => {
    const admission = createCloudflareCobaltRequestAdmission({
      sessionLimiter: {
        limit: async () => {
          throw new Error("binding unavailable");
        },
      },
      clientLimiter: binding(true),
    });

    await expect(admission.admit(request())).resolves.toMatchObject({ status: "unavailable" });
  });

  it("normalizes the local in-memory limiter behind the same interface", async () => {
    const allowed = createInMemoryCobaltRequestAdmission(() => undefined);
    const limited = createInMemoryCobaltRequestAdmission(
      () => new Response("limited", { status: 429 }),
    );

    await expect(allowed.admit(request())).resolves.toEqual({ status: "allowed" });
    await expect(limited.admit(request())).resolves.toEqual({
      status: "limited",
      scope: "client",
    });
  });
});
