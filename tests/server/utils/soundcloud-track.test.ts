import { describe, expect, it } from "vite-plus/test";
import { Effect } from "effect";
import {
  parseSoundCloudMediaPlaylist,
  selectSoundCloudTranscoding,
  soundCloudTrackMetadata,
  type SoundCloudTrack,
} from "../../../server/utils/soundcloud-track";

const playlistUrl = "https://playback.example/aac_160k/track/playlist.m3u8?Policy=p";

const parse = (text: string) => Effect.runSync(parseSoundCloudMediaPlaylist(text, playlistUrl));

const parseFailure = (text: string) =>
  Effect.runSync(Effect.flip(parseSoundCloudMediaPlaylist(text, playlistUrl)));

const transcoding = (preset: string, protocol = "hls", snipped = false) => ({
  url: `https://api-v2.soundcloud.com/media/soundcloud:tracks:1/${preset}/stream/${protocol}`,
  preset,
  duration: 1000,
  snipped,
  format: { protocol, mime_type: "audio/mp4" },
});

describe("soundcloud media playlist", () => {
  it("returns the init segment, media segments and summed duration", () => {
    const result = parse(
      [
        "#EXTM3U",
        "#EXT-X-VERSION:7",
        "#EXT-X-TARGETDURATION:10",
        '#EXT-X-MAP:URI="init.mp4?sig=a"',
        "#EXTINF:10.0078,",
        "https://cdn.example/data000.m4s?sig=b",
        "#EXTINF:5.5,",
        "data001.m4s?sig=c",
        "#EXT-X-ENDLIST",
      ].join("\n"),
    );

    expect(result).toEqual({
      initUrl: "https://playback.example/aac_160k/track/init.mp4?sig=a",
      segmentUrls: [
        "https://cdn.example/data000.m4s?sig=b",
        "https://playback.example/aac_160k/track/data001.m4s?sig=c",
      ],
      durationMs: 15508,
    });
  });

  it.each([
    ["not_m3u8", "#EXTINF:1,\nseg.m4s"],
    ["multivariant", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvariant.m3u8"],
    [
      "encrypted",
      '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"\n#EXT-X-MAP:URI="i.mp4"\n#EXTINF:1,\ns.m4s',
    ],
    ["byterange", '#EXTM3U\n#EXT-X-MAP:URI="i.mp4"\n#EXTINF:1,\n#EXT-X-BYTERANGE:10@0\ns.m4s'],
    ["init", "#EXTM3U\n#EXTINF:1,\ns.m4s"],
    ["empty", '#EXTM3U\n#EXT-X-MAP:URI="i.mp4"\n#EXT-X-ENDLIST'],
    ["segment", '#EXTM3U\n#EXT-X-MAP:URI="i.mp4"\ns.m4s'],
  ])("rejects %s playlists", (reason, text) => {
    expect(parseFailure(text)).toBe(reason);
  });

  it("accepts an explicit unencrypted key", () => {
    expect(
      parse('#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXT-X-MAP:URI="i.mp4"\n#EXTINF:1,\ns.m4s')
        .segmentUrls,
    ).toEqual(["https://playback.example/aac_160k/track/s.m4s"]);
  });
});

describe("soundcloud transcoding selection", () => {
  it("prefers aac_160k hls", () => {
    expect(
      selectSoundCloudTranscoding([
        transcoding("aac_96k"),
        transcoding("abr_sq"),
        transcoding("aac_160k"),
      ])?.preset,
    ).toBe("aac_160k");
  });

  it("falls back to another aac stream and skips snipped, encrypted and malformed entries", () => {
    expect(
      selectSoundCloudTranscoding([
        { preset: "aac_160k" },
        transcoding("aac_160k", "hls", true),
        transcoding("aac_160k", "ctr-encrypted-hls"),
        transcoding("aac_96k"),
      ])?.preset,
    ).toBe("aac_96k");
  });

  it("returns nothing when only legacy or adaptive streams remain", () => {
    expect(
      selectSoundCloudTranscoding([
        transcoding("abr_sq"),
        transcoding("mp3_0_0", "progressive"),
        transcoding("opus_0_0"),
      ]),
    ).toBeUndefined();
  });
});

describe("soundcloud track metadata", () => {
  it("maps the provider tags cobalt used to write", () => {
    const track: SoundCloudTrack = {
      title: " Introitus ",
      genre: "Electronic",
      display_date: "2012-04-02T14:40:38Z",
      license: "all-rights-reserved",
      publisher_metadata: { album_title: "Ecclesia", writer_composer: "Eric Wahlforss" },
      user: { username: "Forss" },
    };

    expect(soundCloudTrackMetadata(track)).toEqual({
      title: "Introitus",
      artist: "Forss",
      album_artist: "Forss",
      album: "Ecclesia",
      composer: "Eric Wahlforss",
      genre: "Electronic",
      date: "2012-04-02",
      copyright: "all-rights-reserved",
    });
  });

  it("omits blank tags", () => {
    expect(
      soundCloudTrackMetadata({ title: "Untitled", genre: " ", publisher_metadata: null }),
    ).toEqual({ title: "Untitled" });
  });
});
