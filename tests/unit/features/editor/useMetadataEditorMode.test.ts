import { act } from "react-test-renderer";
import { useForm } from "react-hook-form";
import { describe, expect, it } from "vite-plus/test";
import { renderHook } from "../../support/hookTestHarness";
import { useMetadataEditorMode } from "@/features/editor/useMetadataEditorMode";
import {
  useLinkedAlbumArtistDisplay,
  validateBpm,
  validateDiscNumber,
} from "@/features/editor/TrackMetadataEditor";
import type { AudioMetadata } from "@/features/library/types";

const metadata: AudioMetadata = {
  filename: "track",
  title: "Track",
  artist: "Artist",
  albumArtist: "Artist",
  album: "",
  year: null,
  genre: "",
  duration: 120,
  bitrate: 320,
  sampleRate: 44_100,
  picture: [],
  trackNumber: null,
  discNumber: null,
  composer: "",
  bpm: null,
  comment: "",
};

describe("metadata editor mode", () => {
  it("persists advanced mode through rerenders and returns to normal when the gate closes", () => {
    const hook = renderHook(({ enabled }: { enabled: boolean }) => useMetadataEditorMode(enabled), {
      enabled: true,
    });

    act(() => hook.result.setMode("advanced"));
    hook.rerender({ enabled: true });
    expect(hook.result.mode).toBe("advanced");

    hook.rerender({ enabled: false });
    expect(hook.result.mode).toBe("normal");
    hook.unmount();
  });

  it("defaults to normal for each new mounted session", () => {
    const first = renderHook(() => useMetadataEditorMode(true), undefined);
    act(() => first.result.setMode("advanced"));
    first.unmount();

    const reloaded = renderHook(() => useMetadataEditorMode(true), undefined);
    expect(reloaded.result.mode).toBe("normal");
    reloaded.unmount();
  });

  it("rejects integer, range, and non-finite advanced numeric values", () => {
    for (const invalid of [Number.NaN, 0, 1.5, 1_000]) {
      expect(validateDiscNumber(invalid)).not.toBe(true);
    }
    for (const invalid of [Number.NaN, 0, 1_000]) {
      expect(validateBpm(invalid)).not.toBe(true);
    }
    expect(validateDiscNumber(null)).toBe(true);
    expect(validateDiscNumber(1)).toBe(true);
    expect(validateDiscNumber(999)).toBe(true);
    expect(validateBpm(null)).toBe(true);
    expect(validateBpm(128.5)).toBe(true);
    expect(validateBpm(999)).toBe(true);
  });

  it("mirrors the live artist without dirtying album artist separately", () => {
    const hook = renderHook(() => {
      const form = useForm<AudioMetadata>({ defaultValues: metadata });
      const displayedAlbumArtist = useLinkedAlbumArtistDisplay(form.control);
      return { form, displayedAlbumArtist };
    }, undefined);

    act(() => hook.result.form.setValue("artist", "Edited Artist", { shouldDirty: true }));

    expect(hook.result.displayedAlbumArtist).toBe("Edited Artist");
    expect(hook.result.form.getFieldState("artist").isDirty).toBe(true);
    expect(hook.result.form.getFieldState("albumArtist").isDirty).toBe(false);
    hook.unmount();
  });
});
