import { Schema } from "effect";
import { HTTPError } from "nitro";
import { describe, expect, it } from "vite-plus/test";
import { decodeRequestBody, urlStringSchema } from "./schema";

const exampleBodySchema = Schema.Struct({
  name: Schema.String,
  count: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 3 })),
});

describe("request body decoding", () => {
  it("decodes valid JSON bodies and ignores unknown fields", async () => {
    const request = new Request("https://tagium.test/example", {
      method: "POST",
      body: JSON.stringify({ name: "Tagium", count: 2, futureField: true }),
    });

    await expect(decodeRequestBody(request, exampleBodySchema)).resolves.toEqual({
      name: "Tagium",
      count: 2,
    });
  });

  it("maps schema failures to HTTP 400 errors with validation context", async () => {
    const request = new Request("https://tagium.test/example", {
      method: "POST",
      body: JSON.stringify({ name: "Tagium", count: 4 }),
    });

    const error = await decodeRequestBody(request, exampleBodySchema).catch((cause) => cause);

    expect(HTTPError.isError(error)).toBe(true);
    expect(error).toMatchObject({ status: 400 });
    expect(error.message).toContain("count");
    expect(error.message).toContain("between 1 and 3");
  });

  it("maps malformed JSON to an HTTP 400 error", async () => {
    const request = new Request("https://tagium.test/example", {
      method: "POST",
      body: "not json",
    });

    await expect(decodeRequestBody(request, exampleBodySchema)).rejects.toMatchObject({
      status: 400,
      message: "Invalid request body: expected valid JSON.",
    });
  });
});

describe("URL string decoding", () => {
  it("preserves the string type while trimming a valid URL", () => {
    expect(Schema.decodeUnknownSync(urlStringSchema)(" https://tagium.app/track ")).toBe(
      "https://tagium.app/track",
    );
  });

  it("rejects invalid URLs", () => {
    expect(() => Schema.decodeUnknownSync(urlStringSchema)("not a URL")).toThrow(
      "Expected a valid URL",
    );
  });
});
