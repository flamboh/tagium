import { describe, expect, it } from "vitest";
import {
  applyMetadataCleanupSuggestions,
  findMetadataCleanupSuggestions,
  suggestTitleCleanup,
  undoMetadataCleanupSuggestions,
} from "./metadataCleanup";
import type { AlbumGroup, AudioMetadata, TagiumFile } from "./types";

const metadata = (title: string, artist = "Burial"): AudioMetadata => ({
  filename: title,
  title,
  artist,
  album: "Untrue",
  year: 2007,
  genre: "Electronic",
  duration: 240,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: 1,
});

const file = (title: string): TagiumFile => ({
  id: "track-1",
  status: "saved",
  downloadStatus: "ready",
  filename: `${title}.mp3`,
  metadata: metadata(title),
});

const album = (title: string, trackId = "track-1"): AlbumGroup => ({
  id: "album-1",
  title,
  artist: "Burial",
  genre: "Electronic",
  trackIds: [trackId],
});

describe("metadata cleanup suggestions", () => {
  it("removes a matching artist prefix and known trailing video label", () => {
    expect(suggestTitleCleanup("Burial - Archangel (Official Audio)", ["Burial"])).toEqual({
      afterTitle: "Archangel",
      reasons: ["artist", "label"],
    });
  });

  it("keeps ambiguous labels and non-matching artist prefixes unchanged", () => {
    expect(suggestTitleCleanup("Audio", ["Burial"])).toBeNull();
    expect(suggestTitleCleanup("Four Tet - Audio (Live)", ["Burial"])).toBeNull();
  });

  it.each([
    "Good Girls (XCX WORLD)",
    "Good Girls [XCX WORLD]",
    "Good Girls - XCX WORLD",
    "Good Girls – XCX WORLD",
    "Good Girls — XCX WORLD",
  ])("removes a trailing album title from %s", (title) => {
    expect(suggestTitleCleanup(title, [], "XCX WORLD")).toEqual({
      afterTitle: "Good Girls",
      reasons: ["album"],
    });
  });

  it("matches album titles using NFKC, case, and whitespace normalization", () => {
    expect(suggestTitleCleanup("Good Girls (ｘｃｘ   ｗｏｒｌｄ)", [], "XCX WORLD")).toEqual({
      afterTitle: "Good Girls",
      reasons: ["album"],
    });
  });

  it("does not remove a title that only consists of the album title", () => {
    expect(suggestTitleCleanup("THIS IS FOR", [], "THIS IS FOR")).toBeNull();
  });

  it("keeps tight dashes, missing album context, and non-matching suffixes unchanged", () => {
    expect(suggestTitleCleanup("Good Girls-XCX WORLD", [], "XCX WORLD")).toBeNull();
    expect(suggestTitleCleanup("Good Girls -XCX WORLD", [], "XCX WORLD")).toBeNull();
    expect(suggestTitleCleanup("Good Girls- XCX WORLD", [], "XCX WORLD")).toBeNull();
    expect(suggestTitleCleanup("Good Girls - XCX WORLD", [])).toBeNull();
    expect(suggestTitleCleanup("Good Girls - BRAT", [], "XCX WORLD")).toBeNull();
  });

  it.each([
    "Good Girls (XCX WORLD) (Official Audio)",
    "Good Girls (Official Audio) (XCX WORLD)",
    "Good Girls - XCX WORLD (Official Audio)",
    "Good Girls (Official Audio) - XCX WORLD",
  ])("composes album cleanup with recognized labels in %s", (title) => {
    expect(suggestTitleCleanup(title, [], "XCX WORLD")).toEqual({
      afterTitle: "Good Girls",
      reasons: ["album", "label"],
    });
  });

  it("uses the containing album group's title", () => {
    expect(
      findMetadataCleanupSuggestions([file("Good Girls (XCX WORLD)")], [album("XCX WORLD")]),
    ).toEqual([expect.objectContaining({ afterTitle: "Good Girls", reasons: ["album"] })]);
  });

  it("uses album artist metadata as a confident prefix match", () => {
    const track = file("Burial — Near Dark [Official Audio]");
    track.metadata = metadata(track.metadata!.title, "");
    const suggestions = findMetadataCleanupSuggestions(
      [track],
      [{ id: "album-1", title: "Untrue", artist: "Burial", genre: "", trackIds: [track.id] }],
    );
    expect(suggestions[0]).toMatchObject({ afterTitle: "Near Dark" });
  });

  it("finds a newly confident artist prefix after artist metadata changes", () => {
    const track = file("leroy — ...LIKE WATCHING A ZOMBIE TURN");
    track.metadata = metadata(track.metadata!.title, "lucida");
    expect(findMetadataCleanupSuggestions([track], [])).toEqual([]);

    track.metadata = { ...track.metadata, artist: "leroy" };
    expect(findMetadataCleanupSuggestions([track], [])).toEqual([
      expect.objectContaining({
        beforeTitle: "leroy — ...LIKE WATCHING A ZOMBIE TURN",
        afterTitle: "...LIKE WATCHING A ZOMBIE TURN",
      }),
    ]);
  });

  it("finds suggestions while tracks are still downloading", () => {
    const track = file("Burial - Archangel (Official Audio)");
    track.downloadStatus = "downloading";

    expect(findMetadataCleanupSuggestions([track], [])).toEqual([
      expect.objectContaining({
        trackId: track.id,
        beforeTitle: "Burial - Archangel (Official Audio)",
        afterTitle: "Archangel",
      }),
    ]);
  });
});

describe("applying metadata cleanup", () => {
  it("buffers cleanup changes before the audio finishes downloading", () => {
    const downloading = file("Burial - Archangel (Official Audio)");
    downloading.downloadStatus = "downloading";
    const [suggestion] = findMetadataCleanupSuggestions([downloading], []);
    const result = applyMetadataCleanupSuggestions([downloading], [suggestion], true);

    expect(result.files[0]).toMatchObject({
      downloadStatus: "downloading",
      pendingMetadataPatch: { title: "Archangel", filename: "Archangel" },
      hasBufferedChanges: true,
    });
  });

  it("merges title and synced filename into the pending metadata patch", () => {
    const original = file("Burial - Archangel (Official Audio)");
    original.pendingMetadataPatch = { year: 2008 };
    const [suggestion] = findMetadataCleanupSuggestions([original], []);
    const result = applyMetadataCleanupSuggestions([original], [suggestion], true);

    expect(result.files[0]).toMatchObject({
      filename: "Archangel.mp3",
      status: "pending",
      pendingMetadataPatch: { year: 2008, title: "Archangel", filename: "Archangel" },
      metadata: { title: "Archangel", filename: "Archangel" },
    });
  });

  it("undoes only cleanup fields and preserves unrelated pending edits", () => {
    const original = file("Burial - Archangel (Official Audio)");
    original.pendingMetadataPatch = { year: 2008 };
    const [suggestion] = findMetadataCleanupSuggestions([original], []);
    const applied = applyMetadataCleanupSuggestions([original], [suggestion], true);
    const [restored] = undoMetadataCleanupSuggestions(applied.files, applied.undoEntries);

    expect(restored).toMatchObject({
      filename: "Burial - Archangel (Official Audio).mp3",
      status: "pending",
      pendingMetadataPatch: { year: 2008 },
      metadata: {
        title: "Burial - Archangel (Official Audio)",
        filename: "Burial - Archangel (Official Audio)",
      },
    });
  });
});
