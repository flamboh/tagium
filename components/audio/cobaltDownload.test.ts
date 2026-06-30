import { describe, expect, it } from "vite-plus/test";
import { applyCobaltAudioMetadata, validateLocalAudioPlan } from "./cobaltDownload";
import type { CobaltDownloadPlan } from "./cobaltDownload";

type LocalAudioPlan = Extract<CobaltDownloadPlan, { status: "local-processing" }>;

const localAudioPlan = (overrides: Partial<LocalAudioPlan> = {}): LocalAudioPlan => ({
  status: "local-processing",
  type: "audio",
  tunnel: ["https://example.com/audio"],
  output: {
    type: "audio/mpeg",
    filename: "track.mp3",
  },
  audio: {
    copy: false,
    format: "mp3",
    bitrate: "128",
  },
  ...overrides,
});

describe("cobaltDownload", () => {
  it("applies Cobalt audio metadata through mp3tag frames", () => {
    const mp3tag = { tags: {} };

    applyCobaltAudioMetadata(mp3tag, {
      title: "Title",
      artist: "Artist",
      album: "Album",
      date: "2026",
      genre: "Genre",
      track: "2",
      album_artist: "Album Artist",
      composer: "Composer",
      copyright: "Copyright",
      sublanguage: "en\u0007g",
    });

    expect(mp3tag.tags).toEqual({
      title: "Title",
      artist: "Artist",
      album: "Album",
      year: "2026",
      genre: "Genre",
      track: "2",
      v2: {
        TPE2: "Album Artist",
        TCOM: "Composer",
        TCOP: "Copyright",
        TLAN: "eng",
      },
    });
  });

  it("rejects unsupported cropped cover art", () => {
    expect(() =>
      validateLocalAudioPlan(
        localAudioPlan({
          tunnel: ["https://example.com/audio", "https://example.com/cover"],
          audio: {
            copy: false,
            format: "mp3",
            bitrate: "128",
            cover: true,
            cropCover: true,
          },
        }),
      ),
    ).toThrow("cobalt local processing response requested unsupported cover crop.");
  });

  it("validates declared cover tunnel shape", () => {
    expect(() =>
      validateLocalAudioPlan(
        localAudioPlan({
          tunnel: ["https://example.com/audio", "https://example.com/cover"],
        }),
      ),
    ).toThrow("cobalt local processing response included unexpected cover tunnel.");

    expect(() =>
      validateLocalAudioPlan(
        localAudioPlan({
          audio: {
            copy: false,
            format: "mp3",
            bitrate: "128",
            cover: true,
          },
        }),
      ),
    ).toThrow("cobalt local processing response missing cover tunnel.");
  });
});
