export type AudioFixtureFormat = "mp3" | "flac" | "m4a" | "opus";

export const audioFixtureTags = {
  title: "Fixture Tone",
  artist: "Tagium Fixtures",
  album: "Fixture Album",
  albumArtist: "Fixture Album Artist",
  year: 2021,
  genre: "Test Tones",
  trackNumber: 3,
  durationSeconds: 2,
} as const;

export const audioFixtures = {
  mp3: {
    file: "tone.mp3",
    stream: "stream.mp3",
    format: "mp3",
    mime: "audio/mpeg",
    frequency: 440,
  },
  flac: {
    file: "tone.flac",
    stream: "stream.flac",
    format: "flac",
    mime: "audio/flac",
    frequency: 550,
  },
  m4a: { file: "tone.m4a", stream: "stream.m4a", format: "m4a", mime: "audio/mp4", frequency: 660 },
  opus: {
    file: "tone.opus",
    stream: "stream.opus",
    format: "opus",
    mime: "audio/ogg",
    frequency: 770,
  },
} as const satisfies Record<
  AudioFixtureFormat,
  { file: string; stream: string; format: AudioFixtureFormat; mime: string; frequency: number }
>;

export type AudioFixtureName = keyof typeof audioFixtures;

export const fixtureTitle = (format: AudioFixtureFormat) => `${audioFixtureTags.title} (${format})`;

export const imageFixtures = {
  cover: { file: "cover.jpg", mime: "image/jpeg", color: "0x3355aa", width: 96, height: 96 },
  thumbnail: {
    file: "thumbnail.jpg",
    mime: "image/jpeg",
    color: "0xaa5533",
    width: 160,
    height: 90,
  },
  artwork: { file: "artwork.png", mime: "image/png", color: "0x33aa55", width: 64, height: 64 },
} as const;

export type ImageFixtureName = keyof typeof imageFixtures;

export type VideoCodec = "h264" | "vp9" | "av1";

export const videoStreamFixtures = {
  "h264-1080": {
    file: "video-h264-1080.mp4",
    mime: "video/mp4",
    codec: "h264",
    height: 1080,
    width: 1920,
  },
  "h264-720": {
    file: "video-h264-720.mp4",
    mime: "video/mp4",
    codec: "h264",
    height: 720,
    width: 1280,
  },
  "h264-480": {
    file: "video-h264-480.mp4",
    mime: "video/mp4",
    codec: "h264",
    height: 480,
    width: 854,
  },
  "vp9-720": {
    file: "video-vp9-720.webm",
    mime: "video/webm",
    codec: "vp9",
    height: 720,
    width: 1280,
  },
  "av1-720": {
    file: "video-av1-720.webm",
    mime: "video/webm",
    codec: "av1",
    height: 720,
    width: 1280,
  },
} as const satisfies Record<
  string,
  { file: string; mime: string; codec: VideoCodec; height: number; width: number }
>;

export type VideoStreamFixtureName = keyof typeof videoStreamFixtures;

export const mediaFixtures = {
  ...videoStreamFixtures,
  "opus-webm": { file: "audio-opus.webm", mime: "audio/webm" },
  "h264-aac-480": { file: "video-h264-aac-480.mp4", mime: "video/mp4" },
  "anim-gif": { file: "anim.gif", mime: "image/gif" },
} as const satisfies Record<string, { file: string; mime: string }>;

export type MediaFixtureName = keyof typeof mediaFixtures;
