import { describe, expect, it } from "vitest";
import {
  applyMetadataCleanupSuggestions,
  findMetadataCleanupSuggestions,
  suggestTitleCleanup,
  undoMetadataCleanupSuggestions,
} from "./metadataCleanup";
import type { AudioMetadata, TagiumFile } from "./types";

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
