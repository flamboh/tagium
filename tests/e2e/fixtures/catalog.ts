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
