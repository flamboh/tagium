import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { audioFixtures, audioFixtureTags, imageFixtures } from "./catalog.ts";

const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const outputDir = dirname(fileURLToPath(import.meta.url));

const run = (...args: string[]) =>
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "inherit",
  });

const bitexact = ["-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact"];

for (const image of Object.values(imageFixtures)) {
  run(
    "-f",
    "lavfi",
    "-i",
    `color=c=${image.color}:s=${image.width}x${image.height}`,
    "-frames:v",
    "1",
    ...bitexact,
    join(outputDir, image.file),
  );
}

const cover = imageFixtures.cover;
const coverPath = join(outputDir, cover.file);

const u32 = (value: number) => {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
};

const flacPictureBlock = (data: Buffer, mime: string, width: number, height: number) =>
  Buffer.concat([
    u32(3),
    u32(mime.length),
    Buffer.from(mime, "ascii"),
    u32(0),
    u32(width),
    u32(height),
    u32(24),
    u32(0),
    u32(data.length),
    data,
  ]);

const metadataArgs = Object.entries({
  title: audioFixtureTags.title,
  artist: audioFixtureTags.artist,
  album: audioFixtureTags.album,
  album_artist: audioFixtureTags.albumArtist,
  date: String(audioFixtureTags.year),
  genre: audioFixtureTags.genre,
  track: String(audioFixtureTags.trackNumber),
}).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]);

const tone = (frequency: number) => [
  "-f",
  "lavfi",
  "-i",
  `sine=frequency=${frequency}:sample_rate=44100:duration=${audioFixtureTags.durationSeconds}`,
];

const codecs = {
  mp3: ["-c:a", "libmp3lame", "-b:a", "64k"],
  flac: ["-c:a", "flac"],
  m4a: ["-c:a", "aac", "-b:a", "64k"],
  opus: ["-c:a", "libopus", "-b:a", "48k"],
} as const;

for (const fixture of Object.values(audioFixtures)) {
  run(
    ...tone(fixture.frequency),
    "-ac",
    "1",
    ...codecs[fixture.format],
    "-map_metadata",
    "-1",
    ...bitexact,
    join(outputDir, fixture.stream),
  );

  const output = join(outputDir, fixture.file);
  const titleArgs = ["-metadata", `title=${audioFixtureTags.title} (${fixture.format})`];
  if (fixture.format === "opus") {
    const picture = flacPictureBlock(
      readFileSync(coverPath),
      cover.mime,
      cover.width,
      cover.height,
    ).toString("base64");
    run(
      ...tone(fixture.frequency),
      "-ac",
      "1",
      ...codecs.opus,
      ...metadataArgs,
      ...titleArgs,
      "-metadata",
      `METADATA_BLOCK_PICTURE=${picture}`,
      ...bitexact,
      output,
    );
    continue;
  }

  const containerArgs = [
    ...(fixture.format === "mp3" ? ["-id3v2_version", "3"] : ["-disposition:v", "attached_pic"]),
    "-metadata:s:v",
    "comment=Cover (front)",
  ];
  run(
    ...tone(fixture.frequency),
    "-i",
    coverPath,
    "-map",
    "0:a",
    "-map",
    "1:v",
    "-ac",
    "1",
    ...codecs[fixture.format],
    "-c:v",
    "copy",
    ...containerArgs,
    ...metadataArgs,
    ...titleArgs,
    ...bitexact,
    output,
  );
}
