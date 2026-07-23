import { describe, expect, it } from "vite-plus/test";
import { buildShareAlbumPreview } from "@/features/share/sharePreview";

const file = (id: string, filename: string, title?: string) => ({
  id,
  filename,
  metadata: title === undefined ? undefined : ({ title } as never),
});

describe("buildShareAlbumPreview", () => {
  it("keeps album order and occurrence-aware keys for duplicate tracks", () => {
    const preview = buildShareAlbumPreview(
      { title: "Mix", trackIds: ["a", "b", "a"], cover: undefined },
      [file("a", "a.mp3", "Same"), file("b", "b.mp3", "Other"), file("a", "a.mp3", "Same")],
    );

    expect(preview.tracks).toEqual([
      { key: "a:0", title: "Same" },
      { key: "b:0", title: "Other" },
      { key: "a:1", title: "Same" },
    ]);
  });

  it("falls back from blank or missing metadata titles to filenames", () => {
    const preview = buildShareAlbumPreview(
      { title: "Mix", trackIds: ["a", "b", "c"], cover: undefined },
      [file("a", "a.mp3", "  "), file("b", "b.mp3"), undefined],
    );

    expect(preview.tracks.map((track) => track.title)).toEqual([
      "a.mp3",
      "b.mp3",
      "untitled track",
    ]);
  });

  it("keeps only display artwork and reports absent artwork as null", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const withCover = buildShareAlbumPreview(
      {
        title: "Mix",
        trackIds: [],
        cover: [{ format: "image/png", type: 3, description: "", data: bytes }],
      },
      [],
    );
    const withoutCover = buildShareAlbumPreview({ title: "Mix", trackIds: [], cover: [] }, []);

    expect(withCover.cover?.format).toBe("image/png");
    expect(withCover.cover?.blob).toBeInstanceOf(Blob);
    expect(withCover.cover?.blob.size).toBe(bytes.byteLength);
    expect(new Uint8Array(await withCover.cover!.blob.arrayBuffer())).toEqual(bytes);
    expect(withoutCover.cover).toBeNull();
  });
});
