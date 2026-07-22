import { describe, expect, it } from "vite-plus/test";
import {
  classifyShareLink,
  shareLinkForSlug,
  shareSlugFromPathname,
} from "@/features/share/shareLink";

const slug = "AbcdEFGHijklmno_123-45";

describe("share link classification", () => {
  it("builds the canonical link used for copying into another workspace", () => {
    expect(shareLinkForSlug(slug, "https://tagium.app")).toBe(`https://tagium.app/share/${slug}`);
  });
  it("recognizes production and current-origin links before media import", () => {
    expect(classifyShareLink(`https://tagium.app/share/${slug}`, "http://localhost:5173")).toEqual({
      kind: "share",
      slug,
    });
    expect(
      classifyShareLink(`http://localhost:5173/share/${slug}`, "http://localhost:5173"),
    ).toEqual({ kind: "share", slug });
  });

  it("rejects unknown Tagium paths locally while leaving other origins as media", () => {
    expect(classifyShareLink("https://tagium.app/not-a-share", "http://localhost:5173")).toEqual({
      kind: "invalid-share",
    });
    expect(classifyShareLink(`https://example.com/share/${slug}`, "http://localhost:5173")).toEqual(
      { kind: "media" },
    );
  });

  it("requires a complete capability URL and strict route shape", () => {
    expect(classifyShareLink(slug, "http://localhost:5173")).toEqual({ kind: "media" });
    expect(classifyShareLink(`https://www.tagium.app/share/${slug}?utm_source=x`, "")).toEqual({
      kind: "invalid-share",
    });
    expect(shareSlugFromPathname(`/share/${slug}`)).toBe(slug);
    expect(shareSlugFromPathname("/share/short")).toBeNull();
  });
});
